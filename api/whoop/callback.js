function hours(ms){
  if(ms==null) return null;
  return ms/3600000;
}

async function whoopGet(path, token){
  const r = await fetch(
    "https://api.prod.whoop.com/developer" + path,
    {
      headers:{
        Authorization:`Bearer ${token}`
      }
    }
  );

  let data = {};

  try{
    data = await r.json();
  }catch{}

  if(!r.ok){
    throw new Error(
      `${path}: ${r.status} ${JSON.stringify(data)}`
    );
  }

  return data;
}

export default async function handler(req,res){

  const {code,error} = req.query;

  if(error){
    return res
      .status(400)
      .send(`WHOOP authorization failed: ${error}`);
  }

  if(!code){
    return res
      .status(400)
      .send("Missing WHOOP authorization code.");
  }

  const redirectUri =
    `https://${req.headers.host}/api/whoop/callback`;

  const body = new URLSearchParams({
    grant_type:"authorization_code",
    code,
    client_id:process.env.WHOOP_CLIENT_ID,
    client_secret:process.env.WHOOP_CLIENT_SECRET,
    redirect_uri:redirectUri
  });

  const tokenResp = await fetch(
    "https://api.prod.whoop.com/oauth/oauth2/token",
    {
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded"
      },
      body
    }
  );

  const tokenData = await tokenResp.json();

  if(!tokenResp.ok){
    return res.status(tokenResp.status).json({
      error:"WHOOP token exchange failed",
      details:tokenData
    });
  }

  try{

    const token = tokenData.access_token;

    const [
      recoveries,
      cycles,
      sleeps,
      bodyMeasurement,
      workouts
    ] = await Promise.all([

      whoopGet(
        "/v2/recovery?limit=1",
        token
      ),

      whoopGet(
        "/v2/cycle?limit=1",
        token
      ),

      whoopGet(
        "/v2/activity/sleep?limit=3",
        token
      ),

      whoopGet(
        "/v2/user/measurement/body",
        token
      ),

      whoopGet(
        "/v2/activity/workout?limit=1",
        token
      ).catch(()=>({records:[]}))

    ]);

    const recovery =
      (recoveries.records || [])[0] || {};

    const cycle =
      (cycles.records || [])[0] || {};

    const sleep =
      (sleeps.records || [])
        .find(x => !x.nap) ||
      (sleeps.records || [])[0] ||
      {};

    const workout =
      (workouts.records || [])[0] || {};

    const rec = recovery.score || {};
    const cyc = cycle.score || {};
    const slp = sleep.score || {};
    const stage = slp.stage_summary || {};

    const sleepHours =
      stage.total_in_bed_time_milli != null
      ? hours(
          stage.total_in_bed_time_milli -
          (stage.total_awake_time_milli || 0)
        )
      : null;

    const q = new URLSearchParams({

      whoop:"1",

      recovery:
        String(rec.recovery_score ?? ""),

      strain:
        String(cyc.strain ?? ""),

      hrv:
        String(rec.hrv_rmssd_milli ?? ""),

      rhr:
        String(rec.resting_heart_rate ?? ""),

      sleepPerformance:
        String(
          slp.sleep_performance_percentage ?? ""
        ),

      sleepHours:
        String(sleepHours ?? ""),

      weightLb:
        String(
          bodyMeasurement.weight_kilogram != null
          ? bodyMeasurement.weight_kilogram * 2.20462
          : ""
        ),

      heightCm:
        String(
          bodyMeasurement.height_meter != null
          ? bodyMeasurement.height_meter * 100
          : ""
        ),

      maxHr:
        String(
          bodyMeasurement.max_heart_rate ?? ""
        ),

      workoutStrain:
        String(
          workout.score?.strain ?? ""
        )

    });

    res.redirect(
      302,
      `https://adaptivefitnesswhoop.vercel.app/?${q.toString()}`
    );

  }catch(e){

    res.status(500).json({

      error:
        "WHOOP authorization worked, but a data request failed.",

      details:
        String(e.message || e)

    });

  }
}
