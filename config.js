// Settings of the whole workshop site. Edit this file to fill in the links that are still open.

// Where results are sent and read. Paste the Google Apps Script web-app URL here (ends in /exec).
// Empty = the pages still work, but nothing is shared between people (each browser keeps its own copy).
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxVsjfFw4M8utEEbDP1-J9q-v6hRiZSMeDfhz-pl0Vb87LHvg0zmNXJXLpmZUKYJkth/exec";
// Results are grouped by session. Use ?s=<name> in the link to keep a rehearsal apart from the workshop.
const SESSION = (new URLSearchParams(location.search).get("s") || "workshop").replace(/[^\w-]/g, "").slice(0, 40) || "workshop";

// The ideas board and the project board share one record in the same sheet (session "board-workshop";
// with ?s=rehearsal it is "board-rehearsal").
const BOARD_SESSION = ("board-" + SESSION).slice(0, 40);

// Standing office hours. Leave url empty until the meeting exists: the landing page then shows "link follows".
const OFFICE_HOURS = {
  url: "",                 // e.g. "https://teams.microsoft.com/l/meetup-join/..."
  when: "",                // e.g. "Every Thursday, 15:00–16:00 Manila time"
};

// Google Form where people leave name, affiliation, email and the project they join (the answers go to
// your Google Sheet, not to this site). Empty = the project board does not mention a form.
// To fill in the project and the name for people: in Google Forms choose "Get pre-filled link", type
// PROJECT, NAME and AFFILIATION into those three questions, and paste the link you get here.
const SIGNUP_FORM = "";

// The super-resolution service the "Make an image" page talks to.
const SR_SERVICE = "https://s-mueller-consult-dev--sr-service-api.us-east.modal.run";

// Who to ask. Empty = "ask the workshop team".
const CONTACT = { name: "", email: "" };
