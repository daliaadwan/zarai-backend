# ZARAI Backend v2 - Gemini AI enabled
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
import os
import json

app = FastAPI(title="ZARAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FIREBASE_URL = os.getenv("FIREBASE_URL", "https://smartsunflower-e2073-default-rtdb.firebaseio.com")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyBTj9S0Ge3b5TMIYK-nJ973oJj-AMGZaC8")

class SensorData(BaseModel):
    temperature: float = None
    soil_humidity: float = None
    air_humidity: float = None
    light: float = None
    node_id: str = "SOL_01"

class AIRequest(BaseModel):
    temperature: float = None
    soil: float = None
    air_humidity: float = None
    light: float = None
    node_id: str = "SOL_01"
    lang: str = "en"

@app.get("/api")
def root():
    return {"status": "ZARAI Backend is running 🌻"}

@app.post("/api/sensors")
async def receive_sensor_data(data: SensorData):
    payload = data.dict()
    async with httpx.AsyncClient() as client:
        r = await client.put(
            f"{FIREBASE_URL}/iot/{data.node_id}/latest.json",
            json=payload
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail="Firebase write failed")
    return {"status": "ok", "data": payload}

@app.get("/api/sensors/{node_id}")
async def get_sensor_data(node_id: str):
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{FIREBASE_URL}/iot/{node_id}/latest.json")
    return r.json()

@app.post("/api/ai-analysis")
async def ai_analysis(data: AIRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")

    lang_instruction = {
        "fr": "Réponds en français.",
        "ar": "أجب باللغة العربية.",
        "en": "Reply in English."
    }.get(data.lang, "Reply in English.")

    prompt = f"""You are ZARAI, an expert AI agriculture assistant for sunflower field monitoring.

Current sensor data from field node {data.node_id}:
- Temperature: {data.temperature}°C
- Soil humidity: {data.soil}%
- Air humidity: {data.air_humidity}%
- Light intensity: {data.light} klux

{lang_instruction}

Based on these REAL sensor values, provide:
1. A short status assessment
2. Up to 3 specific actionable recommendations
3. Any critical alerts if thresholds exceeded:
   - Soil < 25% = critical irrigation needed
   - Soil < 35% = irrigation soon
   - Temperature > 38°C = heat stress
   - Temperature > 40°C = critical heat

Respond ONLY with this JSON, no markdown, no extra text:
{{
  "status": "ok|warning|critical",
  "summary": "one sentence summary",
  "alerts": ["alert1"],
  "recommendations": ["rec1", "rec2", "rec3"]
}}"""

    async with httpx.AsyncClient() as client:
        r = await client.post(
           f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={GEMINI_API_KEY}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500}
            },
            timeout=30
        )

    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Gemini error: {r.text}")

    result = r.json()
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    text = text.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(text)
    except:
        return {"status": "ok", "summary": text, "alerts": [], "recommendations": []}
class ChatRequest(BaseModel):
    message: str
    sensor_data: dict = {}
    lang: str = "en"

@app.post("/api/chat")
async def chat(data: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")

    lang_instruction = {
        "fr": "Réponds en français.",
        "ar": "أجب باللغة العربية.",
        "en": "Reply in English."
    }.get(data.lang, "Reply in English.")

    sensor_context = ""
    if data.sensor_data:
        s = data.sensor_data
        sensor_context = f"""
Current real sensor data:
- Temperature: {s.get('temperature', 'N/A')}°C
- Soil humidity: {s.get('soil', 'N/A')}%
- Air humidity: {s.get('air_humidity', 'N/A')}%
- Light: {s.get('light', 'N/A')} klux
"""

    prompt = f"""You are ZARAI, an expert AI agriculture assistant for sunflower field monitoring. Be concise and helpful.
{sensor_context}
{lang_instruction}
User question: {data.message}"""

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={GEMINI_API_KEY}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.7, "maxOutputTokens": 300}
            },
            timeout=30
        )

    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Gemini error: {r.text}")

    result = r.json()
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    return {"reply": text}
# Serve frontend
app.mount("/", StaticFiles(directory=".", html=True), name="static")
