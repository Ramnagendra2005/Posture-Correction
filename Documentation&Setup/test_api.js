const http = require("http");

function testEndpoint(path, description) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "localhost",
      port: 5000,
      path: path,
      method: "GET",
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        console.log(`\n=== ${description} ===`);
        console.log(`Status: ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log("Response:", JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log("Raw Response:", data);
        }
        resolve(data);
      });
    });

    req.on("error", (e) => {
      console.error(`Error testing ${description}:`, e.message);
      reject(e);
    });

    req.end();
  });
}

async function runTests() {
  try {
    await testEndpoint(
      "/api/posture/report/daily/6892477acf00974cb54bc933?date=2025-01-06",
      "Daily Report for Jan 6"
    );
    await testEndpoint(
      "/api/posture/report/daily/6892477acf00974cb54bc933",
      "Daily Report for Today"
    );
    await testEndpoint(
      "/api/posture/report/weekly/6892477acf00974cb54bc933",
      "Weekly Report"
    );
    await testEndpoint(
      "/api/posture/report/heatmap/6892477acf00974cb54bc933",
      "Heatmap Report"
    );
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTests();
