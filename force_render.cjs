const axios = require("axios");

const PROJECT_ID = "cmpd3whi4000bw80wvz0zvabs";

async function run() {
  try {
    console.log("🚀 Triggering render...");

    const res = await axios.post(
      "http://localhost:4000/api/projects/force-render",
      { projectId: PROJECT_ID }
    );

    console.log("✅ Render triggered:", res.data);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
}

run();