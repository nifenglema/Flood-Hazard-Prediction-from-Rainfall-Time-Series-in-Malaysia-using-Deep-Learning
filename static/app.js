document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('runForecastBtn');
    const locationSelect = document.getElementById('locationSelect');
    const statusMsg = document.getElementById('loaderStatus');
    const errorZone = document.getElementById('errorZone');
    const resultsGrid = document.getElementById('resultsGrid');

    // --- LEAFLET MAP INITIALIZATION ---
    const map = L.map('interactiveMap').setView([4.2105, 101.9758], 6); // Centered on Malaysia
    
    // CARTO Dark Matter TileLayer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // State Geographic Coordinates
    const stateCoords = {
        "Malaysia": [4.2105, 101.9758],
        "Johor": [1.4854, 103.7618],
        "Kedah": [6.1184, 100.3685],
        "Kelantan": [6.1254, 102.2381],
        "Melaka": [2.1896, 102.2501],
        "Negeri Sembilan": [2.7258, 101.9424],
        "Pahang": [3.8126, 103.3256],
        "Penang": [5.4141, 100.3288],
        "Perak": [4.5975, 101.0901],
        "Perlis": [6.4449, 100.2048],
        "Selangor": [3.0738, 101.5183],
        "Terengganu": [5.3117, 103.1324],
        "Sabah": [5.9788, 116.0753],
        "Sarawak": [1.5533, 110.3592]
    };

    // Instantiate Interactive Markers
    Object.keys(stateCoords).forEach(state => {
        if (state === "Malaysia") return; // Skip national average marker
        
        const marker = L.marker(stateCoords[state]).addTo(map);
        marker.bindTooltip(`<b>${state}</b><br>Click to run Flood Analysis`, { direction: "top", className: 'custom-tooltip' });
        
        marker.on('click', () => {
            // Update UI Dropdown
            locationSelect.value = state;
            // Smoothly pan map
            map.flyTo(stateCoords[state], 8, { duration: 1.5 });
            // Auto Trigger AI Forecast
            btn.click();
        });
    });

    // Listen for manual dropdown changes to update map
    locationSelect.addEventListener('change', (e) => {
        const state = e.target.value;
        if(stateCoords[state]) {
            map.flyTo(stateCoords[state], state === "Malaysia" ? 6 : 8, { duration: 1.5 });
        }
    });


    btn.addEventListener('click', async () => {
        // Reset UI State
        btn.classList.add('loading');
        statusMsg.classList.remove('hidden');
        errorZone.classList.add('hidden');
        resultsGrid.classList.add('hidden');
        resultsGrid.innerHTML = '';

        const location = locationSelect.value;

        try {
            const response = await fetch('/api/forecast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ location })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Server error occurred while analyzing matrices.');
            }

            renderForecast(data.forecast);
            
        } catch (error) {
            errorZone.textContent = error.message;
            errorZone.classList.remove('hidden');
        } finally {
            btn.classList.remove('loading');
            statusMsg.classList.add('hidden');
        }
    });

    function renderForecast(forecastArray) {
        forecastArray.forEach((day, idx) => {
            // Determine Danger Level
            let levelClass = 'card-safe';
            let alertLevel = 'Low Risk';
            if (day.flood_prob > 35) {
                levelClass = 'card-warn';
                alertLevel = 'Minor';
            }
            if (day.flood_prob > 75) {
                levelClass = 'card-danger';
                alertLevel = 'FLOOD WARNING';
            }

            // Format Date safely
            const dateObj = new Date(day.datetime);
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

            // Create Node
            const card = document.createElement('div');
            card.className = `glass-panel day-card ${levelClass}`;
            // Stagger animations
            card.style.animationDelay = `${idx * 0.05}s`;

            card.innerHTML = `
                <div class="date-badge">${dateStr}</div>
                <div class="weather-stats">
                    <div class="stat">
                        <span class="stat-val">${Math.round(day.temp)}°</span>
                        <span class="stat-label">Temp</span>
                    </div>
                    <div class="stat">
                        <span class="stat-val">${day.precip}</span>
                        <span class="stat-label">Rain (inch)</span>
                    </div>
                    <div class="stat">
                        <span class="stat-val">${Math.round(day.humidity)}%</span>
                        <span class="stat-label">Humidity</span>
                    </div>
                </div>
                
                <div class="flood-meter">
                    <div class="meter-header">
                        <span class="meter-title">${alertLevel}</span>
                        <span class="meter-val">${day.flood_prob.toFixed(1)}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                </div>
            `;
            
            resultsGrid.appendChild(card);

            // Trigger animation on next frame
            setTimeout(() => {
                const fill = card.querySelector('.progress-fill');
                fill.style.width = `${day.flood_prob}%`;
            }, 100);
        });

        resultsGrid.classList.remove('hidden');
    }
});