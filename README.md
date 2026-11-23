# Practice Flight with Nimbus

A gentle, step-by-step VR practice flight for kids who feel nervous about flying.
It runs in the **Meta Quest Browser** (WebXR), so you don't need an app store, developer account or install.

**Live:** https://fly.widr.one

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

- **On the Quest:** open `https://fly.widr.one` in the Meta Quest Browser, enter the child's name (optional), then press **Enter VR**.
  It's worth bookmarking.
- **Preview on a phone or computer:** press *Preview on this screen*. Drag to look around and tap the buttons.
- Sit on a normal chair, not a swivel chair. Hold the **Meta button** on the right controller to re-centre.
- Point and pull the trigger to press a button. With hand tracking, point and pinch.
- *Start from* lets you jump to one chapter (e.g. just takeoff or just landing) for short, repeated practice.
- A full run takes about 15 minutes. One or two chapters a day in the week before the trip works well.
- Children aged 10–12 need a parent-managed Meta account.

This is a familiarisation tool, not therapy. If the fear is strong or comes with panic, talk to a child psychologist.

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
| `src/main.js` | The story: all of Nimbus's lines (`STEPS`), the takeoff, taxi and landing timelines (`startSeq`), scene setups, input and the start page logic |
| `src/world.js` | Everything 3D: cabin, airliner, wing with moving flaps and spoilers, airport, terrain, clouds, Cloud Lounge, Nimbus |
| `src/ui.js` | The in-VR text panels and buttons (drawn on a canvas) |
| `src/audio.js` | Synthesized sounds (engines, chimes, seatbelt click, bumps) and read-aloud |
| `template.html` | The start page and grown-up tips. The built app is inlined into it |
| `docs/` | The published site: `index.html`, `CNAME`, `.nojekyll`, fonts, favicon, link-preview image |

**Translating:** all the child-facing text is in `STEPS` and in the `cap(...)` calls inside `startSeq` in `src/main.js`. The start page text is in `template.html`.

**Debugging:** add `?debug` to the address to expose `window.__fly` (e.g. `__fly.go('takeoff0')`).

---

## Privacy

There are no accounts, cookies, analytics or third-party requests. The fonts are self-hosted.
The child's name is kept only in the open page and is never stored or sent anywhere.
Read-aloud uses the browser's text-to-speech and prefers voices that run on the device.
Some browsers only offer online voices, which send the spoken text to the browser maker.
Untick *Read the words out loud* to avoid that.

## Credits

- [three.js](https://threejs.org) by the three.js authors, MIT licence. The notice is kept in the built file.
- [Nunito](https://github.com/googlefonts/nunito) font by the Nunito Project Authors, SIL Open Font License 1.1 (`docs/fonts/OFL.txt`), packaged by Fontsource.
- All 3D models, sounds and the Nimbus character are generated in code.
