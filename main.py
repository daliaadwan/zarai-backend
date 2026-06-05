from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx
import os

app = FastAPI(title="ZARAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FIREBASE_URL = os.getenv("FIREBASE_URL", "https://smartsunflower-e2073-default-rtdb.firebaseio.com")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

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
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

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
1. A short status assessment (1 sentence)
2. Up to 3 specific actionable recommendations
3. Any critical alerts if thresholds are exceeded:
   - Soil < 25% = critical irrigation needed
   - Soil < 35% = irrigation soon
   - Temperature > 38°C = heat stress
   - Temperature > 40°C = critical heat

Format your response as JSON only, no markdown:
{{
  "status": "ok|warning|critical",
  "summary": "one sentence summary",
  "alerts": ["alert1", "alert2"],
  "recommendations": ["rec1", "rec2", "rec3"]
}}"""

    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=30
        )

    if r.status_code != 200:
        raise HTTPException(status_code=500, detail="AI request failed")

    result = r.json()
    text = result["content"][0]["text"]

    import json
    try:
        return json.loads(text)
    except:
        return {"status": "ok", "summary": text, "alerts": [], "recommendations": []}

# Serve frontend
app.mount("/", StaticFiles(directory=".", html=True), name="static")
