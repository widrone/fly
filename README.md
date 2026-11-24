# Practice Flight with Nimbus

A gentle, step-by-step VR practice flight for kids who feel nervous about flying.
It runs in the **Meta Quest Browser** (WebXR), so you don't need an app store, developer account or install.

**Live:** https://fly.widr.one

It's in **English** and **Norwegian (Bokmål)**. The start page picks Norsk automatically on a Norwegian device and remembers the choice. You can also switch with the English / Norsk buttons at the top.

Nimbus, a friendly cloud, takes the child through:
Cloud Lounge (cloud breathing) → airport window → window seat and seatbelt → taxi → takeoff → through the clouds → cruising → turbulence they control → landing → Brave Flyer badge.

- Each sound and bump is explained just *before* it happens.
- Nothing moves on until the child presses a button.
- The **Break** button floats them back to the Cloud Lounge to breathe, then returns them to the start of that step.
- The child stays seated and the cabin never moves around them. Only the view outside the window moves, which keeps motion sickness low.

---

## Deploy on GitHub Pages

The site is the `docs/` folder. It's already built, so you don't need to run anything to deploy.

1. **Push this folder to a new repo** (any name, e.g. `fly`):
   ```sh
   git init -b main
   git add .
   git commit -m "Practice Flight with Nimbus"
   git remote add origin git@github.com:YOUR-USERNAME/fly.git
   git push -u origin main
   ```
   Note: drag-and-drop upload on github.com can skip dot-files, so pushing with git is safer.

2. **Turn on Pages:** go to the repo, then *Settings → Pages → Build and deployment*.
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs**, then click Save.

3. **Add the custom domain *before* creating the DNS record:** under *Custom domain*, enter `fly.widr.one` and click Save.
   (`docs/CNAME` already contains it, so GitHub won't need to commit one.)

4. **DNS at your provider for widr.one:**

   | Type  | Name / host | Value                   |
   |-------|-------------|-------------------------|
   | CNAME | `fly`       | `YOUR-USERNAME.github.io` |

   Point it at `YOUR-USERNAME.github.io` only, **without** the repo name.
   Check it with `dig fly.widr.one +short`.

5. **Enforce HTTPS:** once the DNS check in *Settings → Pages* goes green, tick **Enforce HTTPS**.
   The certificate can take up to an hour. **WebXR only works over HTTPS**, so the headset won't offer
   "Enter VR" until this is done.

6. *(Recommended)* **Verify the domain:** in your GitHub account go to *Settings → Pages → Add a domain* and add `widr.one`.
   GitHub gives you a TXT record to add. This stops anyone else's repo from claiming subdomains of widr.one.

---

## Using it

- **On the Quest:** open `https://fly.widr.one` in the Meta Quest Browser, then press **Enter VR**.
  It's worth bookmarking.
- **Preview on a phone or computer:** press *Preview on this screen*. Drag to look around and tap the buttons.
- Sit on a normal chair, not a swivel chair. Hold the **Meta button** on the right controller to re-centre.
- Point and pull the trigger to press a button. With hand tracking, point and pinch.
- *Start from* lets you jump to one chapter (e.g. just takeoff or just landing) for short, repeated practice.
- A full run takes about 15 minutes. One or two chapters a day in the week before the trip works well.
- Children aged 10–12 need a parent-managed Meta account.

This is a familiarisation tool, not therapy. If the fear is strong or comes with panic, talk to a child psychologist.

---

## Sound and rumble (Woojer)

All sound is generated in code (`src/audio.js`). It's placed in 3D around the listener and follows head movement, so with headphones:
- the engines stay outside the window
- the wheels stay under the floor
- the chimes stay overhead
- people chat around you

| Moment | What you hear | What the Woojer does |
|---|---|---|
| Boarding | cabin air, the APU in the tail, chatter, seatbelt clicks, bins closing, bags thumping into the hold below | small thumps from the hold |
| Door and engine start | heavy door thunk, a starter whine rising, then a soft "whoomp" as each engine lights, one after the other | a thunk, then a swell per engine |
| Taxi | the "ba-dum" of runway joints, flap motor whirring | a ba-dum for each joint |
| Takeoff | engines spool up, roar and fan buzz, airflow rising with speed | the rumble builds with speed, then goes quiet at lift-off (smooth!) |
| Wheels up | hydraulic pump whine, doors open, wind roar, rattle, a big **clunk**, doors shut (the engines dip a little so you can hear it) | a hit at each door and a strong clunk |
| Cruise | steady airflow, galley clinks, call bells | nothing; cruise feels smooth |
| Turbulence | a thud for each bump, creaks, rattling bins, the cup clinking | a jolt for each bump, in step with the view, the wing and the water |
| Wheels down | hydraulics, doors, a roar of wind that **stays** while the wheels hang out, two clunks | door hit, two clunks, light buffeting |
| Touchdown | thump and tyre chirp, spoilers, the nose wheel, reverse-thrust roar, rolling | a big hit, the nose wheel, the runway rolling |
| Cloud Lounge | warm pad, soft breeze, wind chimes around you, the breathing tone | a gentle swell with each breath |

**How the rumble works:** the Woojer turns the low end of the audio into vibration (roughly 1–250 Hz).
The app keeps a separate rumble layer around 30–55 Hz. You feel that more than you hear it, so it doesn't make the headphones boom.
It has its own level (*Rumble* on the start page: Off / Gentle / Medium / Strong) and its own dynamics, so a big jolt never squashes what you hear.
The Quest controllers also give a short buzz on the clunks, bumps and touchdown, scaled by the same setting.

**Setup:** run a 3.5 mm cable from the Quest's headphone jack to the Woojer's input, and plug headphones into the Woojer.
Bluetooth adds a delay, so the rumble would lag behind the picture.
The Quest's speakers switch off when the jack is in use. Press **Test** on the start page to check the strap before the headset goes on.

**Tuning:** in `src/audio.js`:
- `update()` sets the continuous levels (the `r(L.…)` lines are what you hear, the `r(H.…)` lines are what you feel).
- `feel(amount, …)` calls inside each event set how hard that event hits.
- `gearUp()`, `gearDown()` and `touchdown()` hold the wheel and landing sequences.
- `_spotlight(delay, duration, depth)` sets how much the background dips under a big moment.

---

## Languages

All the words are in `src/i18n.js`, one block per language. Each block has:
- `steps`: what Nimbus says at each step
- `cap`: the running commentary during taxi, takeoff and landing
- `btn`: the button labels
- `breath`: the breathing exercise
- `ui`: the panel labels and the badge
- `board`: the departure board in the terminal
- `page`: the start page and grown-up tips

- **Changing a line:** edit it in `src/i18n.js`, then run `npm run build`.
- **Adding a language (e.g. Nynorsk):** copy the `nb` block, translate it, and add a button next to English/Norsk in `template.html`. Then let `setLanguage` and the voice picker in `src/audio.js` know its language code.

### Norwegian voice recordings

The Quest browser has no Norwegian text-to-speech voice, so Nimbus's Norwegian lines are pre-recorded MP3s in `docs/voice/nb/` (made with the Kibbu TTS server, then trimmed and loudness-matched with ffmpeg). Each file is named by a short hash of the exact words (`src/voiceclips.js`), and `index.json` lists them. When a line has no recording, for example after you edit the text, the browser's own voice is used for that line if it has one.

- `node tools/voice-lines.mjs nb` lists every spoken line, who says it (`nimbus` or `crew`), and the file name it needs. The crew's lines are played through a loudspeaker filter in the app, and should be recorded with a different voice from Nimbus.
- Make the missing ones, put them in `docs/voice/nb/`, add them to `index.json`, and redeploy.
- **Read-aloud:** this uses the device's built-in voices. Norwegian is only read aloud if the device has a Norwegian voice. It's never read by an English voice. If there's no Norwegian voice, the start page says so and the words are shown on screen only.
  Desktops usually have one (e.g. "Nora" on Mac). The Quest Browser may not.

---

## Changing it

```sh
npm install
npm run build      # writes docs/index.html and copies the fonts into docs/fonts
npm run serve      # http://localhost:8080 (preview mode; VR on the Quest needs the HTTPS site)
```
Commit the updated `docs/` folder and GitHub Pages republishes within a minute or two.

| File | What's in it |
|------|--------------|
| `src/i18n.js` | All the words, in English and Norwegian |
| `src/main.js` | The story's structure (`STEPS`), the taxi, takeoff and landing timelines (`startSeq`), scene setups, input and the start page logic |
| `src/cabin.js` | The cabin interior: curved sidewalls, deep window reveals with glass and shades, seats, bins with service units and row numbers, ceiling, floor, shadows and sunlight patches (all textures generated in code) |
| `src/aircraft.js` | The wing and engine up close: real airfoil shape with panel lines, rivets and NO STEP markings, moving slats, flaps (with their fairings), spoilers and winglet; the engine with a spinning fan, polished lip, core, plug and a thrust reverser that slides open after touchdown. Paint reflects the sky |
| `src/ground.js` | Everything outside during taxi, takeoff and landing: the landscape (fields with crop rows, forest, lakes, roads, villages), close-up ground detail, the runway (asphalt, markings, tyre marks, edge lights, approach lights with the running "rabbit", PAPI), taxiways, signs, windsock, terminal with parked planes, tower, hangars, trees, houses, grass tufts, the plane's shadow, the gate and the clouds |
| `src/safety.js` | The safety demo in the cabin: EXIT signs, floor path lights, glowing frames on the seatbelt, the oxygen-mask panel, the life vest and the safety card, and the props for the "try it yourself" missions |
| `src/terrain.js` | Shared noise and the ring of mountains |
| `src/world.js` | The airliner body, clouds, sky, terminal, Cloud Lounge, Nimbus |
| `src/ui.js` | The in-VR text panels and buttons (drawn on a canvas) |
| `src/audio.js` | The sound engine: 3D ambience, events, the Woojer rumble layer, read-aloud |
| `template.html` | The start page and grown-up tips. The built app is inlined into it |
| `docs/` | The published site: `index.html`, `CNAME`, `.nojekyll`, fonts, favicon, link-preview image |

**Debugging:** add `?debug` to the address to expose `window.__fly` (e.g. `__fly.go('takeoff0')`).

---

## Privacy

There are no accounts, cookies, analytics or third-party requests. The fonts are self-hosted.
Read-aloud uses the browser's text-to-speech and prefers voices that run on the device.
Some browsers only offer online voices, which send the spoken text to the browser maker.
Untick *Read the words out loud* to avoid that.

## Credits

- [three.js](https://threejs.org) by the three.js authors, MIT licence. The notice is kept in the built file.
- [Nunito](https://github.com/googlefonts/nunito) font by the Nunito Project Authors, SIL Open Font License 1.1 (`docs/fonts/OFL.txt`), packaged by Fontsource.
- All 3D models, sounds and the Nimbus character are generated in code.
