const API_BASE_URL = 'http://127.0.0.1:8000';
const GOOGLE_GEO_API_KEY = window.GOOGLE_GEO_API_KEY || '';

const globeElement = document.getElementById('globeViz');
const statusEl = document.getElementById('status');
const latEl = document.getElementById('lat');
const lngEl = document.getElementById('lng');
const altEl = document.getElementById('alt');
const crewListEl = document.getElementById('crew-list');
const crewStatusEl = document.getElementById('crew-status');
const crewCountEl = document.getElementById('crew-count');
const passStatusEl = document.getElementById('pass-status');
const passResultsEl = document.getElementById('pass-results');
const passSourceEl = document.getElementById('pass-source');

const world = Globe()(globeElement)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .atmosphereColor('#3a228a')
    .atmosphereAltitude(0.25)
    .ringColor(() => 'rgba(255, 0, 60, 0.45)')
    .ringMaxRadius(8)
    .ringPropagationSpeed(6)
    .ringRepeatPeriod(1200)
    .pointsData([])
    .pointAltitude(0.18)
    .pointColor(() => '#ff003c')
    .pointRadius(2.3)
    .pointLabel(d => `ISS konumu\nLat: ${d.lat.toFixed(2)}\nLng: ${d.lng.toFixed(2)}`)
    .ringsData([]);

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.45;

const issModelData = [];
world.htmlElementsData(issModelData)
    .htmlElement(() => {
        const el = document.createElement('div');
        el.className = 'iss-icon';
        el.innerText = '🛰️';
        return el;
    })
    .htmlLat(d => d.lat)
    .htmlLng(d => d.lng)
    .htmlAltitude(() => 0.22);

const orbitSegments = [];
world.arcsData(orbitSegments)
    .arcStartLat('startLat')
    .arcStartLng('startLng')
    .arcEndLat('endLat')
    .arcEndLng('endLng')
    .arcColor(() => '#ff003c')
    .arcAltitudeAutoScale(true)
    .arcStroke(0.8)
    .arcDashLength(0.2)
    .arcDashGap(1.2)
    .arcDashInitialGap(() => Math.random())
    .arcDashAnimateTime(2500);

let lastPosition = null;

function updateTrail(newPosition) {
    if (lastPosition) {
        orbitSegments.push({
            startLat: lastPosition.lat,
            startLng: lastPosition.lng,
            endLat: newPosition.lat,
            endLng: newPosition.lng
        });
        if (orbitSegments.length > 90) {
            orbitSegments.splice(0, orbitSegments.length - 90);
        }
        world.arcsData([...orbitSegments]);
    }
    lastPosition = newPosition;
}

function setStatus(state, message) {
    statusEl.classList.remove('waiting', 'ok', 'error');
    statusEl.classList.add(state);
    statusEl.textContent = message;
}

async function updateISS() {
    try {
        const response = await fetch(`${API_BASE_URL}/iss-now`);
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        setStatus('ok', 'Bağlandı');
        latEl.textContent = data.lat.toFixed(2);
        lngEl.textContent = data.lng.toFixed(2);
        altEl.textContent = (data.alt * 6371).toFixed(0);

        const issData = [{ lat: data.lat, lng: data.lng, alt: data.alt }];
        world.pointsData(issData);
        world.ringsData(issData);
        issModelData.splice(0, issModelData.length, ...issData);
        world.htmlElementsData([...issModelData]);
        updateTrail({ lat: data.lat, lng: data.lng });
    } catch (error) {
        console.error('ISS konumu alınamadı:', error);
        setStatus('error', 'Hata');
    }
}

function renderCrewList(people) {
    crewListEl.innerHTML = '';
    if (!people.length) {
        const empty = document.createElement('div');
        empty.textContent = 'Astronot verisi bulunamadı.';
        crewListEl.appendChild(empty);
        return;
    }
    people.forEach(person => {
        const card = document.createElement('div');
        card.className = 'astronaut-card';
        card.innerHTML = `
            <img src="${person.photo}" alt="${person.name}" loading="lazy">
            <div>
                <strong>${person.name}</strong>
                <span>${person.craft}</span>
            </div>
        `;
        crewListEl.appendChild(card);
    });
}

function setCrewStatus(state, message) {
    crewStatusEl.classList.remove('waiting', 'ok', 'error');
    crewStatusEl.classList.add(state);
    crewStatusEl.textContent = message;
}

async function fetchCrew() {
    try {
        const response = await fetch(`${API_BASE_URL}/crew`);
        if (!response.ok) throw new Error('Mürettebat verisi alınamadı');
        const data = await response.json();
        renderCrewList(data.people || []);
        crewCountEl.textContent = `${data.count || 0} kişi`;
        setCrewStatus('ok', `Güncellendi: ${new Date(data.updated_at).toLocaleTimeString('tr-TR')}`);
    } catch (error) {
        console.error('Mürettebat hatası:', error);
        setCrewStatus('error', 'Veri alınamadı');
    }
}

function setPassStatus(state, message) {
    passStatusEl.classList.remove('waiting', 'ok', 'error');
    passStatusEl.classList.add(state);
    passStatusEl.textContent = message;
}

function renderPasses(passes) {
    passResultsEl.innerHTML = '';
    passes.forEach(pass => {
        const li = document.createElement('li');
        li.textContent = pass;
        passResultsEl.appendChild(li);
    });
}

async function fetchPasses(lat, lng) {
    setPassStatus('waiting', 'Yakın geçişler hesaplanıyor...');
    passResultsEl.innerHTML = '';
    try {
        const response = await fetch(`${API_BASE_URL}/predict-pass`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng })
        });
        const data = await response.json();
        if (response.ok && data.passes && data.passes.length) {
            renderPasses(data.passes);
            setPassStatus('ok', 'İlk 3 geçiş hazır.');
        } else {
            setPassStatus('error', data.message || 'Geçiş bulunamadı.');
        }
    } catch (error) {
        console.error('Geçiş hesap hatası:', error);
        setPassStatus('error', 'Sunucuya ulaşılamadı.');
    }
}

function browserGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Tarayıcı konum desteği yok'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, source: 'Tarayıcı' }),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
}

async function resolveLocation() {
    if (GOOGLE_GEO_API_KEY) {
        try {
            const response = await fetch(`https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_GEO_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (response.ok) {
                const data = await response.json();
                if (data.location) {
                    return {
                        lat: data.location.lat,
                        lng: data.location.lng,
                        source: 'Google'
                    };
                }
            }
        } catch (error) {
            console.warn('Google konum isteği başarısız, tarayıcıya düşülüyor', error);
        }
    }
    const coords = await browserGeolocation();
    return coords;
}

async function bootstrapPasses() {
    try {
        const location = await resolveLocation();
        passSourceEl.textContent = `${location.source} konumu`;
        fetchPasses(location.lat, location.lng);
    } catch (error) {
        console.error('Konum alınamadı:', error);
        passSourceEl.textContent = 'Konum alınamadı';
        setPassStatus('error', 'Konum erişimi reddedildi.');
    }
}

updateISS();
fetchCrew();
bootstrapPasses();
setInterval(updateISS, 3000);
setInterval(fetchCrew, 5 * 60 * 1000);
