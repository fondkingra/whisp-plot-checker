import { useState, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Marker, useMapEvents, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4001";
const DEFAULT_CENTER = [0.3, 37.6]; // rough coffee-growing region (Kenya) fallback
const MAX_ZOOM = 18;

const SEARCH_PIN_ICON = divIcon({
  className: "search-pin-icon",
  html: "📍",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const CROP_TYPES = {
  pcrop: { label: "Perennial crop", examples: "coffee, cocoa, rubber, oil palm", riskField: "risk_pcrop" },
  acrop: { label: "Annual crop", examples: "soy, maize, etc.", riskField: "risk_acrop" },
  timber: { label: "Timber", examples: "logging / wood products", riskField: "risk_timber" },
};
const CROP_TYPE_ENTRIES = Object.entries(CROP_TYPES);

function ClickCollector({ onPoint }) {
  useMapEvents({
    click(e) {
      onPoint([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center[0], center[1]]);
  return null;
}

function parseCoordinateInput(text) {
  const t = text.trim();

  const decimal = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (decimal) {
    return [parseFloat(decimal[1]), parseFloat(decimal[2])];
  }

  const dmsPattern = /(\d+)[°\s]+(\d+)['\s]+([\d.]+)["\s]*([NSEW])/gi;
  const matches = [...t.matchAll(dmsPattern)];
  if (matches.length === 2) {
    const toDecimal = (deg, min, sec, dir) => {
      let val = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
      if (dir === "S" || dir === "W") val = -val;
      return val;
    };
    const vals = matches.map((m) => ({
      dir: m[4].toUpperCase(),
      val: toDecimal(m[1], m[2], m[3], m[4].toUpperCase()),
    }));
    const lat = vals.find((v) => v.dir === "N" || v.dir === "S");
    const lon = vals.find((v) => v.dir === "E" || v.dir === "W");
    if (lat && lon) return [lat.val, lon.val];
  }

  return null;
}

const INDICATOR_LABELS = {
  Ind_01_treecover: "Tree cover present",
  Ind_02_commodities: "Commodity crop detected",
  Ind_03_disturbance_before_2020: "Forest disturbance before 2020",
  Ind_04_disturbance_after_2020: "Forest disturbance after 2020 (EUDR cutoff)",
  Ind_05_primary_2020: "Primary forest in 2020",
  Ind_06_nat_reg_forest_2020: "Naturally regenerating forest in 2020",
  Ind_07_planted_plantations_2020: "Planted plantation in 2020",
  Ind_08_planted_plantations_after_2020: "New plantation after 2020",
  Ind_09_treecover_after_2020: "Tree cover change after 2020",
  Ind_10_agri_after_2020: "Agriculture expansion after 2020",
  Ind_11_logging_concession_before_2020: "Logging concession before 2020",
};
const INDICATOR_ENTRIES = Object.entries(INDICATOR_LABELS);

function riskLevel(props, cropType) {
  const field = CROP_TYPES[cropType].riskField;
  const risk = props[field];
  if (!risk) return "unknown";
  const r = risk.toLowerCase();
  if (r === "high") return "high";
  if (r === "more_info_needed") return "more_info_needed";
  if (r === "low") return "low";
  return "unknown";
}

const LEVEL_META = {
  low: { label: "Likely Compliant", color: "#2a9d8f", icon: "✅" },
  high: { label: "High Risk — Needs Review", color: "#d62828", icon: "⚠️" },
  more_info_needed: { label: "More Info Needed", color: "#e8a33d", icon: "❔" },
  unknown: { label: "Unknown", color: "#6c757d", icon: "❔" },
};

function ComplianceCard({ whispResponse, cropType, farmerName }) {
  const feature = whispResponse?.data?.features?.[0];
  if (!feature) return null;
  const props = feature.properties;
  const level = riskLevel(props, cropType);
  const cropMeta = CROP_TYPES[cropType];
  const levelMeta = LEVEL_META[level];

  const flaggedIndicators = INDICATOR_ENTRIES.filter(
    ([key]) => props[key] && props[key].toLowerCase() === "yes"
  );

  return (
    <div className="compliance-card" style={{ borderColor: levelMeta.color }}>
      <div className="compliance-header" style={{ background: levelMeta.color }}>
        <span className="compliance-icon">{levelMeta.icon}</span>
        <div>
          <div className="compliance-label">{levelMeta.label}</div>
          <div className="compliance-sublabel">
            {farmerName ? `${farmerName} — ` : ""}{cropMeta.label} ({cropMeta.examples})
          </div>
        </div>
      </div>

      <div className="compliance-body">
        <div className="compliance-meta">
          <div><strong>Area</strong><span>{props.Area?.toFixed(2)} {props.Unit}</span></div>
          <div><strong>Country</strong><span>{props.Country}</span></div>
          <div><strong>Region</strong><span>{props.Admin_Level_1}</span></div>
        </div>

        <div className="risk-badges">
          {CROP_TYPE_ENTRIES.map(([key, meta]) => (
            <span
              key={key}
              className={`risk-badge risk-${props[meta.riskField]} ${key === cropType ? "risk-badge-selected" : ""}`}
            >
              {meta.label}: {props[meta.riskField]}
            </span>
          ))}
        </div>

        {flaggedIndicators.length > 0 ? (
          <div className="indicators">
            <strong>Flags raised:</strong>
            <ul>
              {flaggedIndicators.map(([key, label]) => (
                <li key={key}>{label}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="indicators indicators-clean">No deforestation or disturbance flags raised.</div>
        )}
      </div>
    </div>
  );
}

function pointsToGeoJSON(points, farmerName, cropType) {
  const ring = points.map(([lat, lng]) => [lng, lat]);
  ring.push(ring[0]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { plotId: "demo-plot-1", farmerName: farmerName || null, cropType },
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
      },
    ],
  };
}

export default function App() {
  const [points, setPoints] = useState([]);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [coordInput, setCoordInput] = useState("");
  const [farmerName, setFarmerName] = useState("");
  const [cropType, setCropType] = useState("pcrop");
  const [imageryMissing, setImageryMissing] = useState(false);
  const [searchPin, setSearchPin] = useState(null);

  const addPoint = useCallback((pt) => {
    setPoints((prev) => [...prev, pt]);
    setSearchPin(null);
  }, []);

  const undoPoint = () => setPoints((prev) => prev.slice(0, -1));

  const resetAll = () => {
    setPoints([]);
    setResult(null);
    setError(null);
  };

  const goToCoordinate = () => {
    const parsed = parseCoordinateInput(coordInput);
    if (!parsed) {
      setError("Couldn't parse coordinates. Try \"13.2277, 75.3742\" or \"13°13'39.7\\\"N 75°22'27.3\\\"E\".");
      return;
    }
    setCenter(parsed);
    setSearchPin(parsed);
    setError(null);
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pt = [pos.coords.latitude, pos.coords.longitude];
        setCenter(pt);
        setSearchPin(pt);
        setLocating(false);
      },
      (err) => {
        setError("Could not get location: " + err.message);
        setLocating(false);
      }
    );
  };

  const submitPlot = async () => {
    if (points.length < 3) {
      setError("Tap at least 3 corners to form a plot.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const geojson = pointsToGeoJSON(points, farmerName, cropType);
      const res = await axios.post(`${BACKEND_URL}/api/check-plot`, geojson);
      setResult(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      const detail = err.response?.data?.detail;
      setError(detail ? `${msg}: ${JSON.stringify(detail)}` : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🌱 Whisp Plot Check</h1>
        <p>Tap your field's corners on the map, then check EUDR compliance risk.</p>
      </header>

      <section className="panel">
        <div className="panel-title">1. Find your plot</div>
        <div className="panel-row">
          <input
            type="text"
            placeholder="Go to coords: 13.2277, 75.3742 or DMS"
            value={coordInput}
            onChange={(e) => setCoordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goToCoordinate()}
            className="coord-input"
          />
          <button onClick={goToCoordinate}>Go</button>
          <button onClick={locateMe} disabled={locating}>
            {locating ? "Locating…" : "📍 Use my location"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">2. Farmer &amp; crop details</div>
        <div className="panel-row">
          <input
            type="text"
            placeholder="Farmer name"
            value={farmerName}
            onChange={(e) => setFarmerName(e.target.value)}
            className="coord-input"
          />
          <select value={cropType} onChange={(e) => setCropType(e.target.value)} className="crop-select">
            {CROP_TYPE_ENTRIES.map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label} ({meta.examples})
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">3. Draw the plot — tap each corner on the map</div>
        <div className="map-wrap">
          <MapContainer center={center} zoom={16} maxZoom={MAX_ZOOM} style={{ height: "500px", width: "100%" }}>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={MAX_ZOOM}
              maxNativeZoom={17}
              eventHandlers={{ tileerror: () => setImageryMissing(true), tileload: () => setImageryMissing(false) }}
            />
            <Recenter center={center} />
            <ClickCollector onPoint={addPoint} />
            {searchPin && <Marker position={searchPin} icon={SEARCH_PIN_ICON} />}
            {points.map((pt, i) => (
              <CircleMarker key={i} center={pt} radius={6} pathOptions={{ color: "#ffb703", fillColor: "#ffb703", fillOpacity: 1 }} />
            ))}
            {points.length >= 3 && (
              <Polygon positions={points} pathOptions={{ color: "#2a9d8f", fillOpacity: 0.3 }} />
            )}
          </MapContainer>
        </div>

        {imageryMissing && (
          <div className="imagery-notice">
            High-res satellite imagery isn't available at this zoom for this location — zoom out a bit, or draw at the current detail level.
          </div>
        )}

        <div className="panel-row map-actions">
          <button onClick={undoPoint} disabled={points.length === 0}>
            ↩ Undo last point
          </button>
          <button onClick={resetAll} disabled={points.length === 0 && !result} className="danger">
            ✕ Clear everything
          </button>
          <button onClick={submitPlot} disabled={submitting || points.length < 3} className="primary">
            {submitting ? "Checking…" : "✓ Check compliance"}
          </button>
          <span className="point-count">{points.length} corner{points.length === 1 ? "" : "s"} placed</span>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      {result && <ComplianceCard whispResponse={result} cropType={cropType} farmerName={farmerName} />}

      {result && (
        <details className="raw-details">
          <summary>Raw Whisp response (JSON)</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
