import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const WHISP_API_KEY = process.env.WHISP_API_KEY;
const WHISP_URL = "https://whisp.openforis.org/api/submit/geojson";

app.post("/api/check-plot", async (req, res) => {
  if (!WHISP_API_KEY) {
    return res.status(500).json({ error: "WHISP_API_KEY not set on server" });
  }

  const geojson = req.body;
  if (!geojson || geojson.type !== "FeatureCollection") {
    return res.status(400).json({ error: "Body must be a GeoJSON FeatureCollection" });
  }

  try {
    const response = await axios.post(WHISP_URL, geojson, {
      headers: {
        "X-API-KEY": WHISP_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      timeout: 30000,
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message;
    res.status(status).json({ error: "Whisp API request failed", detail });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, keyConfigured: !!WHISP_API_KEY });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
