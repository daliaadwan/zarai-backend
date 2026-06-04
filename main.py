from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

class SensorData(BaseModel):
    temperature: float = None
    soil_humidity: float = None
    air_humidity: float = None
    light: float = None
    node_id: str = "SOL_01"

@app.get("/")
def root():
    return {"status": "ZARAI Backend is running 🌻"}

@app.post("/sensors")
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

@app.get("/sensors/{node_id}")
async def get_sensor_data(node_id: str):
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{FIREBASE_URL}/iot/{node_id}/latest.json")
    return r.json()
