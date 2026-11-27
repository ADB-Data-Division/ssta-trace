# Super-resolution workshop site (SSTA, 26–27 November 2026)

The landing page of the workshop and its sub-pages, served by GitHub Pages at
https://adb-data-division.github.io/ssta-trace/. Plain HTML, CSS and JavaScript: no build step.

| Page | Path | What it is |
|---|---|---|
| Landing page | `index.html` | All links and the office hours link (the questions and answers section is empty for now; the first draft is in commit 52cfe39) |
| Ideas board | `ideas/` | A whiteboard: sticky notes that everyone can add, drag around, vote for and turn into a project; headings to name groups of notes |
| Project board | `projects/` | Projects with a problem and why it matters, and a place; people join with name and affiliation |
| Image service | `sr/` | A page in front of the super-resolution service: place, date, options, price check, viewer (Sentinel-2 inputs, stage 1, stage 2, validity mask), warnings, downloads |
| Exercises | `exercises/` | List of exercises; the road tracing (day 1) is at `exercises/trace/` (`results.html` is the presenter view); "Spot the differences" (day 2) is a link to a live Excalidraw room |
| Open datasets | `datasets/` | Open datasets by theme, with search and filters. `index.html` is built from `notebooks/hackathon/DATASETS.md` of the sr-client repo by `build_datasets.py` (kept outside this repo): change the list there, not here |
| Colab version of the tracing | `trace_roads.ipynb` | For networks that block this site (built by `build_notebook.py`, kept outside this repo) |

## The Excalidraw link of the day 2 exercise

The address of the room is written into `exercises/index.html` and `index.html` (search for `excalidraw.com`).
A live Excalidraw room belongs to the session that started it: if you start a new session, put the new link in
both files. Everyone with the link can change the board.

## Links that are still open: `config.js`

Everything you may need to change is in `config.js`:

- `OFFICE_HOURS`: the meeting link and the time. While `url` is empty the landing page says "The meeting link follows".
- `SIGNUP_FORM`: a Google Form for contact details (see below). While empty, the project board does not mention a form.
- `CONTACT`: a name and an email address for the "Who do I ask?" answer.
- `SR_SERVICE`: the address of the super-resolution service.
- `ENDPOINT`: the Google Apps Script web app that stores the tracing results and the two boards.

Add `?s=<name>` to any page to work in a separate session, e.g. `?s=rehearsal`. The links between the pages keep it.

## Where the boards are stored

The ideas board and the project board need no server of their own. Every action (add a note, vote, start a
project, join) is one row added to the Google Sheet behind `ENDPOINT`, in the session `board-workshop`
(`board-<name>` with `?s=<name>`). The pages read all rows and replay them (`assets/board.js`), and ask for news
every 6 to 8 seconds. A note's place on the whiteboard is part of the record: dragging a note adds one row with
its new place, and the row that arrived last wins. Rows are only ever added:

- a removed note or project is still in the sheet;
- to start with an empty board, delete the rows of that session in the sheet, or use a new `?s=` name;
- everyone with the link can add, change and remove things, like on a whiteboard in the room.

The web app is the one from the tracing exercise (`apps_script.gs`); it did not have to change.

## Sign-up form for contact details (optional)

The project board shows only a name and an affiliation, because everyone with the link can read it. Email
addresses go through a Google Form, so they end up in your own Google Sheet:

1. Create a Google Form with the questions: Project, Name, Affiliation, Email address.
2. In the form's menu choose "Get pre-filled link". Type `PROJECT`, `NAME` and `AFFILIATION` into those three
   questions (leave the email empty) and copy the link.
3. Paste the link into `config.js` as `SIGNUP_FORM`. The board replaces the three words with the project a
   person joined and the name and affiliation they typed.

## The image page and where its pictures come from

`sr/` talks to the service straight from the browser: sign-up by email (`POST /v1/signup`), estimate (asked
automatically about a second after the form changes; it is free), submit, follow the job, list the files. The key
stays in the browser's local storage. The ready-made areas in `sr/areas.js` send exactly the boxes of the
notebooks, so images that already exist come back at once and free.

| What the page shows | Where it comes from | Works today |
|---|---|---|
| Stage 1 and stage 2 | The service's preview pictures, shown as plain images from the file store | yes, **except on networks that block the file store** (the ADB wifi blocks `backblazeb2.com`, found on 27 November 2026) |
| Sentinel-2 inputs (one image per date, click to show) | Read by the page from the public Sentinel-2 archive on AWS (`sentinel-cogs`, the files the service itself uses), cut to the job's frame; about 5 MB per image | yes |
| Small pictures of the Sentinel-2 images on the "New image" tab, before an image is made | Read by the page from the same archive: the ready-made true-colour file (`TCI.tif`) at 20 m, cut to the chosen area; about 0.7 MB per picture, the 18 nearest to the date at once, the rest on a click | yes |
| Warnings with the measured values | The service (`GET /v1/jobs/{id}`) | yes |
| Validity mask, shares of valid / weak / empty area, the exact images used, `lr_reference.tif` as a layer, saving a picture with one click | The job's own files in the file store (Backblaze B2 bucket of the service) | only after the bucket allows this site, or the service hands out files itself (below) |

To allow it, add a CORS rule to the bucket: in the Backblaze web console open the bucket's "CORS Rules", choose
"Share everything in this bucket with this one origin", enter `https://adb-data-division.github.io`, and apply it to
the S3-compatible API (or both). The page notices by itself: it tries to read `manifest.json` of the job and uses
the service's files when that works. The rule only lets this site's pages read files through links that are
already signed; it does not make anything public.

### Files through the service, for networks that block the file store

Every result file has a second way to the page: `GET <service>/v1/jobs/<job id>/files/<file name>` with the key
(`Authorization: Bearer …`), answering with the bytes of that file. The page tries the file store first and this
address second (pictures: at once when the store refuses, after 4 seconds when it does not answer). With it,
stage 1 and stage 2 show on networks that block the store, and the validity mask, the exact images used and
one-click saving work everywhere, without the CORS rule on the bucket.

The service needs that route for this to work. Until it has it, the page tells people on such a network that the
file store is blocked, still shows the Sentinel-2 inputs, and offers Colab instead: a button copies the Python code
for this image (with the person's key), a link opens a new Colab notebook to paste it into. The route in the service's `api.py`, next to `results`:

    @app.get("/v1/jobs/{job_id}/files/{name}")
    def result_file(job_id: str, name: str, caller: Caller, db: Db) -> Response:
        """One published file through the API, for networks that block the object store."""
        job = own_job(db, caller, job_id)
        files_of = job.cached_from or job.id
        try:
            manifest = json.loads(deps.store.get(out_key(files_of, "manifest.json")))
            if name not in manifest["files"] or ("stage2" in name and "2" not in job.params["stages"]):
                raise HTTPException(404, "no such file")
            data = deps.store.get(out_key(files_of, name))
        except NotFound:
            raise HTTPException(404, "no such file") from None
        kind = "image/png" if name.endswith(".png") else "image/tiff" if name.endswith(".tif") else "application/json"
        return Response(data, media_type=kind, headers={"Cache-Control": "private, max-age=3600"})

(`Response` from `fastapi`. The API's CORS settings already allow the `Authorization` header from any site.)
`mock_api.py` of the tests has the same route (`VIA_API=1`); `t_sr_blocked.py` tests the page with the store
open, blocked and silent.

## Collecting tracing results (Google Sheet, about 5 minutes)

1. Create a new Google Sheet.
2. Open Extensions > Apps Script, replace the code with `apps_script.gs`, and save.
3. Open Deploy > New deployment > type "Web app". Set Execute as: Me, Who has access: Anyone, then Deploy and authorise.
4. Paste the web-app URL (it ends in `/exec`) into `config.js` as `ENDPOINT`.

The tracing stores only line coordinates, scores, a random device id and the time.

Credits: roads and maps © OpenStreetMap contributors. Real images in the tracing exercise: Google satellite imagery,
averaged to 2.5 m. Contains modified Copernicus Sentinel data. Map library: Leaflet. GeoTIFF reader: geotiff.js.
