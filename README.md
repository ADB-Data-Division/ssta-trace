# Super-resolution workshop site (SSTA, 26–27 November 2026)

The landing page of the workshop and its sub-pages, served by GitHub Pages at
https://adb-data-division.github.io/ssta-trace/. Plain HTML, CSS and JavaScript: no build step.

| Page | Path | What it is |
|---|---|---|
| Landing page | `index.html` | All links, the office hours link and the questions and answers |
| Ideas board | `ideas/` | Sticky notes for the brainstorming: add, vote, group, turn into a project |
| Project board | `projects/` | Projects with a goal, a place and needs; people join with name and affiliation |
| Make an image | `sr/` | A page in front of the super-resolution service: place, date, options, images, downloads |
| Exercises | `exercises/` | List of exercises; the road tracing is at `exercises/trace/` (`results.html` is the presenter view) |
| Colab version of the tracing | `trace_roads.ipynb` | For networks that block this site (built by `build_notebook.py`, kept outside this repo) |

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
every 6 to 8 seconds. Rows are only ever added:

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

## The image page and the file store

`sr/` talks to the service straight from the browser: sign-up by email (`POST /v1/signup`), estimate, submit,
follow the job, list the files. The key stays in the browser's local storage. The ready-made areas in
`sr/areas.js` send exactly the boxes of the notebooks, so images that already exist come back at once and free.

The preview pictures are shown as plain images, which always works. Two things work only if the file store
(the Backblaze B2 bucket of the service) allows this site to read files: the Sentinel-2 image in the comparison
view, and saving a picture with one click. To allow it, add a CORS rule to the bucket for the origin
`https://adb-data-division.github.io` (downloads, S3-compatible API). The page notices by itself.

## Collecting tracing results (Google Sheet, about 5 minutes)

1. Create a new Google Sheet.
2. Open Extensions > Apps Script, replace the code with `apps_script.gs`, and save.
3. Open Deploy > New deployment > type "Web app". Set Execute as: Me, Who has access: Anyone, then Deploy and authorise.
4. Paste the web-app URL (it ends in `/exec`) into `config.js` as `ENDPOINT`.

The tracing stores only line coordinates, scores, a random device id and the time.

Credits: roads and maps © OpenStreetMap contributors. Real images in the tracing exercise: Google satellite imagery,
averaged to 2.5 m. Contains modified Copernicus Sentinel data. Map library: Leaflet. GeoTIFF reader: geotiff.js.
