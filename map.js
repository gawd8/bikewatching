import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiZ2F3ZDgiLCJhIjoiY213aGN5aGZ0MGdlYzMwcG53ZGhyam56NyJ9.2YhI80vYyp_iRymbaAzKGA';

// Create the Boston map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(
    +station.lon,
    +station.lat
  );

  const { x, y } = map.project(point);

  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);

  return date.toLocaleString('en-US', {
    timeStyle: 'short',
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  stations.forEach((station) => {
    const id = station.short_name;

    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic =
      station.departures + station.arrivals;
  });

  return stations;
}

function filterTripsbyTime(trips, timeFilter) {
  if (timeFilter === -1) {
    return trips;
  }

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

map.on('load', async () => {
  // Load Boston bike lane data
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  // Draw bike lanes on the map
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
        'line-color': '#32D400',
        'line-width': 5,
        'line-opacity': 0.6,
    },
  });

  // Cambridge bike network
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://services3.arcgis.com/iuNbZYJOrAYBrPyC/ArcGIS/rest/services/Cambridge_BLC_Line_Data_WFL1/FeatureServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
        'line-color': '#32D400',
        'line-width': 5,
        'line-opacity': 0.6,
    },
  });

  // Load Bluebikes station data
  try {
    const stationURL =
        'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    const jsonData = await d3.json(stationURL);
    console.log('Loaded JSON Data:', jsonData);

    const stations = jsonData.data.stations;
    console.log('Stations Array:', stations);

    const svg = d3.select('#map').select('svg');

    const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .join('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8);

    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Load March 2024 Bluebikes trip data
    const trafficURL =
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    const trips = await d3.csv(trafficURL, (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
    });

    console.log('Loaded trips:', trips.length);
    console.log('First trip:', trips[0]);

    computeStationTraffic(stations, trips);

    console.log('Stations with traffic:', stations);
    
    // Scale circle size by station traffic
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

    const stationFlow = d3.scaleQuantize()
        .domain([0, 1])
        .range([0, 0.5, 1]);

    // Update station marker sizes
    circles
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr('fill-opacity', 0.6)
        .style('--departure-ratio', (d) =>
            d.totalTraffic > 0
            ? stationFlow(d.departures / d.totalTraffic)
            : 0.5
        );

    // Add traffic information to each station marker
    circles.each(function (d) {
        d3.select(this)
            .selectAll('title')
            .data([d])
            .join('title')
            .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
    });


    // Time slider controls
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    let timeFilter = -1;

    function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);

    const filteredStations = computeStationTraffic(
        stations,
        filteredTrips
    );

    if (timeFilter === -1) {
        radiusScale.range([0, 25]);
    } else {
        radiusScale.range([3, 50]);
    }

    circles
        .data(filteredStations, (d) => d.short_name)
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .style('--departure-ratio', (d) =>
            d.totalTraffic > 0
            ? stationFlow(d.departures / d.totalTraffic)
            : 0.5
        );

    circles.select('title')
        .text((d) =>
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    }

    function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
            selectedTime.textContent = '';
            anyTimeLabel.style.display = 'block';
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = 'none';
        }
    
        updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

  } 
  
  catch (error) {
    console.error('Error loading JSON:', error);
  }
});