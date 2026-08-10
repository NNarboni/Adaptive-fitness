import crypto from "crypto";

export default function handler(req,res){
  const state=crypto.randomBytes(12).toString("hex");
 const redirectUri="https://adaptivefitnesswhoop.vercel.app/api/whoop/callback ;
  const scope=[
    "offline",
    "read:recovery",
    "read:cycles",
    "read:sleep",
    "read:workout",
    "read:body_measurement"
  ].join(" ");
  const u=new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
  u.searchParams.set("client_id",process.env.WHOOP_CLIENT_ID||"");
  u.searchParams.set("redirect_uri",redirectUri);
  u.searchParams.set("response_type","code");
  u.searchParams.set("scope",scope);
  u.searchParams.set("state",state);
  res.redirect(u.toString());
}
