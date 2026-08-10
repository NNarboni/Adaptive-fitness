function hours(ms){
  if(ms==null) return null;
  return (ms/3600000).toFixed(1);
}
function safe(v, fallback="—"){
  return v===undefined || v===null ? fallback : v;
}
async function whoopGet(path, token){
  const r=await fetch("https://api.prod.whoop.com/developer"+path,{
    headers:{Authorization:`Bearer ${token}`}
  });
  let data={};
  try{ data=await r.json(); }catch{}
  if(!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req,res){
  const {code,error}=req.query;
  if(error) return res.status(400).send(`WHOOP authorization failed: ${error}`);
  if(!code) return res.status(400).send("Missing WHOOP authorization code.");

  const redirectUri=`https://${req.headers.host}/api/whoop/callback`;
  const body=new URLSearchParams({
    grant_type:"authorization_code",
    code,
    client_id:process.env.WHOOP_CLIENT_ID,
    client_secret:process.env.WHOOP_CLIENT_SECRET,
    redirect_uri:redirectUri
  });

  const tokenResp=await fetch("https://api.prod.whoop.com/oauth/oauth2/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });

  const tokenData=await tokenResp.json();
  if(!tokenResp.ok){
    return res.status(tokenResp.status).json({error:"WHOOP token exchange failed",details:tokenData});
  }

  try{
    const token=tokenData.access_token;

    const [recoveries, cycles, sleeps, bodyMeasurement, workouts] = await Promise.all([
      whoopGet("/v2/recovery?limit=1", token),
      whoopGet("/v2/cycle?limit=1", token),
      whoopGet("/v2/activity/sleep?limit=3", token),
      whoopGet("/v2/user/measurement/body", token),
      whoopGet("/v2/activity/workout?limit=1", token).catch(()=>({records:[]}))
    ]);

    const recovery=(recoveries.records||[])[0]||{};
    const cycle=(cycles.records||[])[0]||{};
    const sleep=(sleeps.records||[]).find(x=>!x.nap) || (sleeps.records||[])[0] || {};
    const workout=(workouts.records||[])[0]||{};

    const rec=recovery.score||{};
    const cyc=cycle.score||{};
    const slp=sleep.score||{};
    const stage=slp.stage_summary||{};

    const sleepHours = stage.total_in_bed_time_milli != null
      ? hours(stage.total_in_bed_time_milli - (stage.total_awake_time_milli||0))
      : null;

    const html=`<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WHOOP Data · Adaptive Fitness</title>
<style>
body{margin:0;background:#0b0d0f;color:#f6f7f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:560px;margin:auto;padding:28px 18px 60px}
h1{font-size:30px;margin:8px 0}p{color:#9aa4ad;line-height:1.45}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
.card{background:#15191d;border:1px solid #293038;border-radius:17px;padding:16px}
.label{font-size:12px;color:#9aa4ad;text-transform:uppercase;letter-spacing:.04em}
.value{font-size:34px;font-weight:800;margin-top:5px}.green{color:#7cff67}
.wide{grid-column:1/-1}.small{font-size:16px}.btn{display:block;text-align:center;background:#7cff67;color:#071006;text-decoration:none;font-weight:800;padding:15px;border-radius:14px;margin-top:16px}
.notice{background:#101a12;border-radius:13px;padding:13px;color:#bdeeb6}
</style>
<main>
<div class="notice">✓ WHOOP connected — live data retrieved successfully</div>
<h1>Your WHOOP today</h1>
<p>This page is now reading your WHOOP account directly through the Adaptive Fitness backend.</p>
<div class="grid">
  <div class="card"><div class="label">Recovery</div><div class="value green">${safe(rec.recovery_score)}%</div></div>
  <div class="card"><div class="label">Day Strain</div><div class="value">${safe(cyc.strain)}</div></div>
  <div class="card"><div class="label">HRV</div><div class="value">${rec.hrv_rmssd_milli!=null?Math.round(rec.hrv_rmssd_milli):"—"}<span class="small"> ms</span></div></div>
  <div class="card"><div class="label">Resting HR</div><div class="value">${safe(rec.resting_heart_rate)}<span class="small"> bpm</span></div></div>
  <div class="card"><div class="label">Sleep Performance</div><div class="value">${safe(slp.sleep_performance_percentage)}%</div></div>
  <div class="card"><div class="label">Sleep Time</div><div class="value">${safe(sleepHours)}<span class="small"> hr</span></div></div>
  <div class="card wide"><div class="label">Body</div><div style="font-size:20px;font-weight:700;margin-top:8px">${bodyMeasurement.weight_kilogram!=null?(bodyMeasurement.weight_kilogram*2.20462).toFixed(1)+" lb":"—"} · ${bodyMeasurement.height_meter!=null?(bodyMeasurement.height_meter*100).toFixed(0)+" cm":"—"} · Max HR ${safe(bodyMeasurement.max_heart_rate)} bpm</div></div>
  <div class="card wide"><div class="label">Most Recent WHOOP Workout</div><div style="font-size:20px;font-weight:700;margin-top:8px">${workout.sport_name?workout.sport_name:"No recent workout returned"}${workout.score?.strain!=null?" · Strain "+workout.score.strain:""}</div></div>
</div>
<a class="btn" href="/api/whoop/start">Refresh WHOOP data</a>
<p style="font-size:12px">For this validation build, the access token is used only during this request and is never displayed in the browser. Persistent secure token storage is the next step.</p>
</main>`;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.status(200).send(html);
  }catch(e){
    res.status(500).json({
      error:"WHOOP authorization worked, but a data request failed.",
      details:String(e.message||e)
    });
  }
}
