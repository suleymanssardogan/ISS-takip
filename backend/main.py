from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from skyfield.api import Topos, load
import datetime
import requests

CREW_SOURCE_URL = "http://api.open-notify.org/astros.json"
CREW_CACHE_TTL = datetime.timedelta(minutes=10)
ORBital_PATH_DURATION_MIN = 90
ORBITAL_PATH_STEP_MIN = 2
DEFAULT_PHOTO = "https://www.nasa.gov/wp-content/uploads/2023/05/default-astronaut.jpg"
ASTRONAUT_PHOTOS = {
    "Oleg Kononenko": "https://www.nasa.gov/wp-content/uploads/2023/08/oleg-kononenko.jpg",
    "Nikolai Chub": "https://www.nasa.gov/wp-content/uploads/2023/08/nikolai-chub.jpg",
    "Tracy Caldwell Dyson": "https://www.nasa.gov/wp-content/uploads/2023/08/tracy-caldwell-dyson.jpg",
    "Matthew Dominick": "https://www.nasa.gov/wp-content/uploads/2024/02/matthew-dominick.jpg",
    "Jeanette Epps": "https://www.nasa.gov/wp-content/uploads/2024/02/jeanette-epps.jpg",
    "Michael Barratt": "https://www.nasa.gov/wp-content/uploads/2024/02/michael-barratt.jpg",
    "Alexander Grebenkin": "https://www.nasa.gov/wp-content/uploads/2024/02/alexander-grebenkin.jpg",
}

crew_cache = {"data": None, "expires_at": datetime.datetime.min}

app = FastAPI()

# --- CORS AYARLARI ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ISS VERİLERİNİ YÜKLE ---
# 1. Veriyi indir (Bu bize bir LİSTE döner)
stations_list = load.tle_file('https://celestrak.org/NORAD/elements/stations.txt')

# 2. Listeyi SÖZLÜĞE (Dictionary) çevir
# Bu sayede stations['ISS (ZARYA)'] diyerek erişebiliriz.
stations = {sat.name: sat for sat in stations_list}

# Artık hata vermeyecek
iss = stations['ISS (ZARYA)']
ts = load.timescale()

class LocationRequest(BaseModel):
    lat: float
    lng: float

@app.get("/")
def home():
    return {"status": "Space Backend Running 🚀"}

@app.get("/iss-now")
def get_iss_location():
    """ISS'in anlık 3D koordinatlarını ve yüksekliğini döner"""
    t = ts.now()
    geocentric = iss.at(t)
    subpoint = geocentric.subpoint()
    
    return {
        "lat": subpoint.latitude.degrees,
        "lng": subpoint.longitude.degrees,
        "alt": subpoint.elevation.km / 6371.0 
    }

@app.post("/predict-pass")
def predict_pass(loc: LocationRequest):
    """Kullanıcının üzerinden ne zaman geçeceğini hesaplar"""
    observer = Topos(latitude_degrees=loc.lat, longitude_degrees=loc.lng)
    t0 = ts.now()
    t1 = ts.from_datetime(t0.utc_datetime() + datetime.timedelta(days=2)) 

    # 10 derece ufuk yüksekliği
    times, events = iss.find_events(observer, t0, t1, altitude_degrees=10.0)
    
    passes = []
    for ti, event in zip(times, events):
        if event == 0: # Sadece doğuş (Rise) zamanlarını alalım
            passes.append(ti.utc_datetime().strftime('%d-%m-%Y %H:%M UTC'))
            
    if not passes:
        return {"message": "Yakın zamanda geçiş yok."}
    
    return {"passes": passes[:3]}

@app.get("/crew")
def get_crew():
    """Tüm astronot listesini fotoğraflarıyla döner"""
    now = datetime.datetime.utcnow()
    if crew_cache["data"] and crew_cache["expires_at"] > now:
        return crew_cache["data"]

    try:
        response = requests.get(CREW_SOURCE_URL, timeout=10)
        response.raise_for_status()
    except requests.RequestException as err:
        raise HTTPException(status_code=502, detail="Mürettebat servisine ulaşılamadı.") from err

    payload = response.json()
    all_people = payload.get("people", [])
    decorated_people = []
    for person in all_people:
        name = person.get("name", "Bilinmiyor")
        decorated_people.append(
            {
                "name": name,
                "craft": person.get("craft", "Bilinmiyor"),
                "photo": ASTRONAUT_PHOTOS.get(name, DEFAULT_PHOTO)
            }
        )

    crew_payload = {
        "count": len(decorated_people),
        "people": decorated_people,
        "updated_at": now.replace(microsecond=0).isoformat() + "Z"
    }
    crew_cache["data"] = crew_payload
    crew_cache["expires_at"] = now + CREW_CACHE_TTL
    return crew_payload


@app.get("/iss-path")
def iss_path():
    """Önümüzdeki 90 dakikalık ISS yörünge noktalarını verir"""
    t0 = ts.now()
    base_dt = t0.utc_datetime()

    points = []
    for minute in range(0, ORBital_PATH_DURATION_MIN + ORBITAL_PATH_STEP_MIN, ORBITAL_PATH_STEP_MIN):
        future_dt = base_dt + datetime.timedelta(minutes=minute)
        tf = ts.from_datetime(future_dt)
        geocentric = iss.at(tf)
        subpoint = geocentric.subpoint()
        points.append(
            {
                "lat": subpoint.latitude.degrees,
                "lng": subpoint.longitude.degrees,
                "alt": subpoint.elevation.km / 6371.0,
                "timestamp": future_dt.replace(microsecond=0).isoformat() + "Z"
            }
        )

    return {"points": points}