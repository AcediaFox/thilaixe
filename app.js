"use strict";

/**
 * @typedef {Object<string, string>} AnswerMap
 */

/**
 * @typedef {Object} Question
 * @property {number} id
 * @property {string} question
 * @property {AnswerMap} answer
 * @property {string} correct_answer
 * @property {boolean} critical_question
 * @property {string} explain
 * @property {string} image
 */

/**
 * @typedef {Object} AttemptAnswer
 * @property {number} id
 * @property {string} selected
 */

/**
 * @typedef {Object} Attempt
 * @property {string} id
 * @property {string} startedAt
 * @property {string} submittedAt
 * @property {number} durationSeconds
 * @property {number} score
 * @property {number} total
 * @property {boolean} expired
 * @property {AttemptAnswer[]} answers
 */

/**
 * @typedef {Object<string, string>} SelectedMap
 */

/**
 * @typedef {"practice" | "mock"} ExamMode
 */

/**
 * @typedef {"idle" | "saving" | "saved" | "error"} SaveState
 */

/**
 * @typedef {Object} Session
 * @property {ExamMode} mode
 * @property {number} examNumber
 * @property {Question[]} questions
 * @property {SelectedMap} selected
 * @property {number} index
 * @property {boolean} submitted
 * @property {boolean} expired
 * @property {string} startedAt
 * @property {number} startedMs
 * @property {string} submittedAt
 * @property {number} durationSeconds
 * @property {number} score
 * @property {number} endsAtMs
 * @property {number} timerId
 * @property {SaveState} saveState
 */

/**
 * @typedef {Object} ExamModel
 * @property {ExamMode | "history"} mode
 * @property {string} title
 * @property {string} subtitle
 * @property {Question[]} questions
 * @property {SelectedMap} selected
 * @property {number} index
 * @property {boolean} locked
 * @property {number} score
 * @property {number} total
 * @property {string} banner
 * @property {string} backRoute
 * @property {string} backLabel
 * @property {boolean} showSubmit
 * @property {boolean} showRetry
 * @property {boolean} showTimer
 * @property {number} remainingSeconds
 * @property {boolean} urgent
 * @property {string} saveNote
 */

/**
 * @typedef {string | number | boolean | null | JsonValue[] | JsonObject} JsonValue
 * @typedef {{ [key: string]: JsonValue }} JsonObject
 */

const PRACTICE_SIZE = 50;
const PRACTICE_COUNT = 12;
const MOCK_SIZE = 30;
const PASS_SCORE = 27;
const MOCK_LIMIT_SECONDS = 20 * 60;
const IMAGE_PATH = /^images\/[0-9]+\.(jpg|png)$/;
const HISTORY_KEY = "thilaixe-history";

/** @type {Question[]} */
let bank = [];
/** @type {Question[][]} */
let practiceExams = [];
/** @type {Map<number, Question>} */
let questionById = new Map();
/** @type {Attempt[]} */
let attempts = [];
/** @type {Session | null} */
let session = null;
/** @type {number} */
let historyIndex = 0;
/** @type {string} */
let historyShownId = "";
/** @type {(() => void) | null} */
let modalAction = null;

$(function () {
  bindEvents();
  boot();
});

function bindEvents() {
  $(document).on("click", "[data-route]", function (event) {
    event.preventDefault();
    const route = $(this).attr("data-route");
    if (typeof route !== "string" || route === "") return;
    askLeave(route);
  });

  $("#view").on("click", "[data-action]", function () {
    const action = $(this).attr("data-action");
    if (action === "start-practice") {
      const examNumber = Number($(this).attr("data-exam"));
      if (Number.isInteger(examNumber)) startPractice(examNumber);
      return;
    }
    if (action === "start-mock") {
      startMock();
      return;
    }
    if (action === "submit") {
      askSubmit();
      return;
    }
    if (action === "retry") {
      retryExam();
      return;
    }
    if (action === "prev") {
      moveIndex(-1);
      return;
    }
    if (action === "next") {
      moveIndex(1);
      return;
    }
    if (action === "goto") {
      const index = Number($(this).attr("data-index"));
      if (Number.isInteger(index)) setIndex(index);
      return;
    }
    if (action === "jump") {
      const jumpId = $(this).attr("data-jump");
      if (typeof jumpId !== "string") return;
      const target = document.getElementById(jumpId);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  $("#view").on("change", "#question-panel input[type='radio']", function () {
    if (!session || session.submitted) return;
    const question = session.questions[session.index];
    const selected = $(this).val();
    if (!question || typeof selected !== "string") return;
    if (typeof question.answer[selected] !== "string") return;
    session.selected[String(question.id)] = selected;
    paintLiveChrome();
  });

  $(document).on("keydown", function (event) {
    if ($("#modal").hasClass("is-active")) {
      if (event.key === "Escape") closeModal();
      return;
    }
    if (!session || session.submitted) return;
    if (!/^[1-4]$/.test(event.key)) return;
    const question = session.questions[session.index];
    if (!question || typeof question.answer[event.key] !== "string") return;
    const input = document.querySelector("#question-panel input[value='" + event.key + "']");
    if (input instanceof HTMLInputElement) {
      input.checked = true;
      $(input).trigger("change");
    }
  });

  $("#modal-ok").on("click", function () {
    const action = modalAction;
    closeModal();
    if (action) action();
  });

  $(document).on("click", "[data-action='modal-close']", function () {
    closeModal();
  });

  $(window).on("hashchange", function () {
    if (session) return;
    render();
  });
}

function boot() {
  const questions = parseQuestions(readQuestionBank());
  if (!questions || questions.length === 0) {
    renderMessage("Không đọc được bộ câu hỏi.", true);
    return;
  }
  bank = questions.slice().sort(function (left, right) {
    return left.id - right.id;
  }).slice(0, PRACTICE_SIZE * PRACTICE_COUNT);
  questionById = new Map(bank.map(function (question) {
    return [question.id, question];
  }));
  practiceExams = [];
  for (let examNumber = 0; examNumber < PRACTICE_COUNT; examNumber += 1) {
    const slice = bank.slice(examNumber * PRACTICE_SIZE, (examNumber + 1) * PRACTICE_SIZE);
    if (slice.length > 0) practiceExams.push(slice);
  }
  attempts = readHistory();
  if (location.hash === "") {
    history.replaceState(null, "", "#/practice");
  }
  render();
}

/**
 * @returns {JsonValue | null}
 */
function readQuestionBank() {
  if (!("QUESTION_BANK" in window)) return null;
  const value = window.QUESTION_BANK;
  if (!Array.isArray(value)) return null;
  return value;
}

/**
 * @returns {Attempt[]}
 */
function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return parseHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * @returns {boolean}
 */
function writeHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ attempts: attempts }));
    return true;
  } catch {
    return false;
  }
}

function render() {
  updateNav();
  if (session) {
    $("#view").html(page(examMarkup(sessionModel())));
    return;
  }
  const route = readRoute();
  if (route.name === "mock") {
    $("#view").html(page(mockMarkup()));
    return;
  }
  if (route.name === "history" && route.attemptId !== "") {
    $("#view").html(page(historyDetailMarkup(route.attemptId)));
    return;
  }
  if (route.name === "history") {
    $("#view").html(page(historyMarkup()));
    return;
  }
  $("#view").html(page(practiceMarkup()));
}

/**
 * @returns {{ name: "practice" | "mock" | "history", attemptId: string }}
 */
function readRoute() {
  const parts = (location.hash || "").replace(/^#/, "").split("/").filter(function (part) {
    return part !== "";
  });
  if (parts[0] === "mock") return { name: "mock", attemptId: "" };
  if (parts[0] === "history") return { name: "history", attemptId: parts[1] || "" };
  return { name: "practice", attemptId: "" };
}

function updateNav() {
  const route = readRoute();
  const active = session
    ? (session.mode === "practice" ? "practice" : "mock")
    : (route.name === "history" ? "mock" : route.name);
  $("[data-nav]").each(function () {
    const key = $(this).attr("data-nav");
    $(this).toggleClass("is-active", key === active);
  });
}

/**
 * @param {string} html
 */
function page(html) {
  return '<div class="container">' + html + "</div>";
}

function practiceMarkup() {
  const cards = practiceExams.map(function (questions, index) {
    const examNumber = index + 1;
    const first = questions[0];
    const last = questions[questions.length - 1];
    if (!first || !last) return "";
    const label = String(examNumber).padStart(2, "0");
    return (
      '<article class="exam-card">' +
        '<div class="exam-card-top">' +
          '<span class="exam-num">' + label + "</span>" +
          "<div>" +
            "<h2>Đề " + examNumber + "</h2>" +
            "<p>Câu " + first.id + "–" + last.id + "</p>" +
          "</div>" +
        "</div>" +
        '<p class="exam-meta">' + questions.length + " câu · không giới hạn thời gian</p>" +
        '<button class="button is-primary is-fullwidth" type="button" data-action="start-practice" data-exam="' + examNumber + '">Làm bài</button>' +
      "</article>"
    );
  }).join("");
  return (
    '<header class="page-head">' +
      "<h1 class=\"page-title\">Luyện thi</h1>" +
      "<p class=\"page-lead\">12 đề, mỗi đề 50 câu theo thứ tự bộ 600 câu. Làm xong bấm nộp bài để chấm điểm, xem đáp án và phần giải thích chi tiết kèm mẹo nhớ.</p>" +
    "</header>" +
    '<div class="exam-grid">' + cards + "</div>"
  );
}

function mockMarkup() {
  return (
    tabsMarkup("mock") +
    '<div class="card mock-panel">' +
      '<div class="card-content">' +
        '<p class="exam-kicker">Đề ngẫu nhiên</p>' +
        "<h1 class=\"page-title\">Thi thử</h1>" +
        '<p class="page-lead">Một đề lấy ngẫu nhiên từ toàn bộ 600 câu.</p>' +
        '<ul class="rule-list">' +
          "<li>30 câu, không trùng nhau.</li>" +
          "<li>Thời gian làm bài 20 phút.</li>" +
          "<li>Hết giờ hệ thống tự nộp bài và chấm điểm.</li>" +
          "<li>Sai câu điểm liệt thì không đạt, dù đúng từ 27 câu.</li>" +
          "<li>Kết quả được lưu vào lịch sử.</li>" +
        "</ul>" +
        '<button class="button is-primary" type="button" data-action="start-mock">Bắt đầu làm bài</button>' +
      "</div>" +
    "</div>"
  );
}

function historyMarkup() {
  if (attempts.length === 0) {
    return (
      tabsMarkup("history") +
      "<h1 class=\"page-title\">Lịch sử thi thử</h1>" +
      '<div class="empty-state">Chưa có lần thi nào.</div>'
    );
  }
  const items = attempts.map(function (attempt) {
    const tone = isPassed(attempt.score, attempt.total, attemptMissedCritical(attempt)) ? " is-pass" : " is-fail";
    return (
      '<a class="history-item' + tone + '" href="#/history/' + escapeHtml(attempt.id) + '" data-route="/history/' + escapeHtml(attempt.id) + '">' +
        '<span class="history-score">' + attempt.score + "<small>/" + attempt.total + "</small></span>" +
        '<span class="history-meta">' +
          escapeHtml(formatDateTime(attempt.submittedAt)) +
          " · " + escapeHtml(formatDuration(attempt.durationSeconds)) +
        "</span>" +
      "</a>"
    );
  }).join("");
  return (
    tabsMarkup("history") +
    "<h1 class=\"page-title\">Lịch sử thi thử</h1>" +
    '<p class="page-lead">Chọn một lần làm để xem chi tiết đáp án.</p>' +
    items
  );
}

/**
 * @param {string} attemptId
 */
function historyDetailMarkup(attemptId) {
  const attempt = attempts.find(function (item) {
    return item.id === attemptId;
  });
  if (!attempt) {
    return (
      tabsMarkup("history") +
      '<div class="notification is-warning is-light">Không tìm thấy bài làm này.</div>' +
      '<a class="button" href="#/history" data-route="/history">Quay lại lịch sử</a>'
    );
  }
  if (historyShownId !== attemptId) {
    historyShownId = attemptId;
    historyIndex = 0;
  }
  return examMarkup(attemptModel(attempt));
}

/**
 * @param {"mock" | "history"} active
 */
function tabsMarkup(active) {
  return (
    '<div class="tabs is-boxed app-tabs">' +
      "<ul>" +
        '<li class="' + (active === "mock" ? "is-active" : "") + '"><a href="#/mock" data-route="/mock">Thi</a></li>' +
        '<li class="' + (active === "history" ? "is-active" : "") + '"><a href="#/history" data-route="/history">Lịch sử</a></li>' +
      "</ul>" +
    "</div>"
  );
}

/**
 * @param {number} examNumber
 */
function startPractice(examNumber) {
  const questions = practiceExams[examNumber - 1];
  if (!questions || questions.length === 0) return;
  destroySession();
  session = createSession("practice", questions, examNumber);
  render();
}

function retryExam() {
  if (!session || !session.submitted) return;
  if (session.mode !== "practice" && session.mode !== "mock") return;
  const mode = session.mode;
  const examNumber = session.examNumber;
  const questions = session.questions.slice();
  destroySession();
  session = createSession(mode, questions, examNumber);
  render();
  window.scrollTo(0, 0);
}

function startMock() {
  if (bank.length < MOCK_SIZE) {
    renderMessage("Bộ câu hỏi không đủ 30 câu để thi thử.", true);
    return;
  }
  destroySession();
  session = createSession("mock", pickRandom(bank, MOCK_SIZE), 0);
  render();
}

/**
 * @param {ExamMode} mode
 * @param {Question[]} questions
 * @param {number} examNumber
 * @returns {Session}
 */
function createSession(mode, questions, examNumber) {
  const startedMs = Date.now();
  /** @type {Session} */
  const next = {
    mode: mode,
    examNumber: examNumber,
    questions: questions,
    selected: {},
    index: 0,
    submitted: false,
    expired: false,
    startedAt: new Date(startedMs).toISOString(),
    startedMs: startedMs,
    submittedAt: "",
    durationSeconds: 0,
    score: 0,
    endsAtMs: mode === "mock" ? startedMs + MOCK_LIMIT_SECONDS * 1000 : 0,
    timerId: 0,
    saveState: "idle",
  };
  if (mode === "mock") {
    next.timerId = window.setInterval(tickTimer, 250);
  }
  return next;
}

function destroySession() {
  if (!session) return;
  if (session.timerId !== 0) window.clearInterval(session.timerId);
  session.timerId = 0;
  session = null;
}

function tickTimer() {
  if (!session || session.submitted || session.mode !== "mock") return;
  const remaining = remainingSeconds(session.endsAtMs, Date.now());
  const $timer = $("#timer");
  if ($timer.length) {
    $timer.text(formatClock(remaining));
    $timer.toggleClass("is-urgent", remaining <= 60);
  }
  if (remaining <= 0) finishExam(true);
}

/**
 * @param {boolean} expired
 */
function finishExam(expired) {
  if (!session || session.submitted) return;
  const current = session;
  current.submitted = true;
  current.expired = expired;
  current.submittedAt = new Date().toISOString();
  current.durationSeconds = Math.max(0, Math.round((Date.now() - current.startedMs) / 1000));
  if (current.mode === "mock") {
    current.durationSeconds = Math.min(current.durationSeconds, MOCK_LIMIT_SECONDS);
  }
  current.score = countScore(current.questions, current.selected);
  if (current.timerId !== 0) {
    window.clearInterval(current.timerId);
    current.timerId = 0;
  }
  closeModal();
  if (current.mode === "mock") {
    saveAttempt(current);
    return;
  }
  render();
}

/**
 * @param {Session} snapshot
 */
function saveAttempt(snapshot) {
  /** @type {AttemptAnswer[]} */
  const answers = snapshot.questions.map(function (question) {
    return {
      id: question.id,
      selected: snapshot.selected[String(question.id)] || "",
    };
  });
  /** @type {Attempt} */
  const attempt = {
    id: createAttemptId(),
    startedAt: snapshot.startedAt,
    submittedAt: snapshot.submittedAt,
    durationSeconds: snapshot.durationSeconds,
    score: snapshot.score,
    total: snapshot.questions.length,
    expired: snapshot.expired,
    answers: answers,
  };
  attempts.unshift(attempt);
  snapshot.saveState = writeHistory() ? "saved" : "error";
  render();
}

function createAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return String(Date.now());
}

function askSubmit() {
  if (!session || session.submitted) return;
  const missing = unansweredCount(session);
  const message = missing > 0
    ? "Bạn còn " + missing + " câu chưa trả lời. Những câu này được tính là sai. Nộp bài chứ?"
    : "Nộp bài để xem đáp án và giải thích từng câu?";
  openModal("Nộp bài", message, function () {
    finishExam(false);
  });
}

/**
 * @param {string} route
 */
function askLeave(route) {
  if (session && !session.submitted) {
    openModal("Thoát bài", "Bài đang làm sẽ không được lưu. Bạn có chắc muốn thoát?", function () {
      destroySession();
      setRoute(route);
    });
    return;
  }
  destroySession();
  setRoute(route);
}

/**
 * @param {string} route
 */
function setRoute(route) {
  const next = "#" + route;
  if (location.hash === next) {
    render();
    return;
  }
  location.hash = next;
}

/**
 * @param {number} delta
 */
function moveIndex(delta) {
  if (!session || session.submitted) return;
  setIndex(session.index + delta);
}

/**
 * @param {number} index
 */
function setIndex(index) {
  if (!session || session.submitted) return;
  if (index < 0 || index >= session.questions.length) return;
  session.index = index;
  render();
  const panel = document.getElementById("question-panel");
  if (panel) panel.scrollIntoView({ block: "start" });
}

function paintLiveChrome() {
  if (!session || session.submitted) return;
  const question = session.questions[session.index];
  if (!question) return;
  const selected = session.selected[String(question.id)] || "";
  $("#question-panel .option").each(function () {
    const input = $(this).find("input");
    $(this).toggleClass("is-selected", input.val() === selected);
  });
  $("#palette").html(paletteMarkup(sessionModel()));
  $("#progress").text(progressText(session.questions, session.selected));
}

/**
 * @returns {ExamModel}
 */
function sessionModel() {
  if (!session) {
    return emptyModel();
  }
  const total = session.questions.length;
  const first = session.questions[0];
  const last = session.questions[total - 1];
  const title = session.mode === "practice" ? "Đề " + session.examNumber : "Thi thử";
  const subtitle = session.mode === "practice"
    ? "Câu " + (first ? first.id : "") + "–" + (last ? last.id : "") + " · không giới hạn thời gian"
    : "30 câu ngẫu nhiên · 20 phút";
  let banner = "";
  if (session.submitted) {
    const wrong = total - session.score;
    banner = "Đúng " + session.score + " câu · Sai " + wrong + " câu · " + formatDuration(session.durationSeconds);
    if (session.expired) banner += " · Hết giờ, bài đã được nộp tự động";
  }
  let saveNote = "";
  if (session.mode === "mock" && session.submitted) {
    if (session.saveState === "saved") saveNote = "Đã lưu vào lịch sử trên trình duyệt này.";
    if (session.saveState === "error") saveNote = "Không lưu được lịch sử trên trình duyệt này.";
  }
  const remaining = session.mode === "mock" && !session.submitted
    ? remainingSeconds(session.endsAtMs, Date.now())
    : 0;
  return {
    mode: session.mode,
    title: title,
    subtitle: subtitle,
    questions: session.questions,
    selected: session.selected,
    index: session.index,
    locked: session.submitted,
    score: session.score,
    total: total,
    banner: banner,
    backRoute: session.mode === "practice" ? "/practice" : "/mock",
    backLabel: session.mode === "practice" ? "Danh sách đề" : "Về thi thử",
    showSubmit: !session.submitted,
    showRetry: session.submitted,
    showTimer: session.mode === "mock" && !session.submitted,
    remainingSeconds: remaining,
    urgent: remaining <= 60,
    saveNote: saveNote,
  };
}

/**
 * @param {Attempt} attempt
 * @returns {ExamModel}
 */
function attemptModel(attempt) {
  /** @type {Question[]} */
  const questions = [];
  /** @type {SelectedMap} */
  const selected = {};
  attempt.answers.forEach(function (answer) {
    const question = questionById.get(answer.id);
    if (!question) return;
    questions.push(question);
    selected[String(question.id)] = answer.selected;
  });
  const status = attempt.expired ? "Hết giờ tự nộp" : "Nộp bài";
  return {
    mode: "history",
    title: "Chi tiết bài thi",
    subtitle: formatDateTime(attempt.submittedAt) + " · " + formatDuration(attempt.durationSeconds) + " · " + status,
    questions: questions,
    selected: selected,
    index: 0,
    locked: true,
    score: attempt.score,
    total: attempt.total,
    banner: "Đúng " + attempt.score + " câu · Sai " + (attempt.total - attempt.score) + " câu",
    backRoute: "/history",
    backLabel: "Quay lại lịch sử",
    showSubmit: false,
    showRetry: false,
    showTimer: false,
    remainingSeconds: 0,
    urgent: false,
    saveNote: "",
  };
}

/**
 * @returns {ExamModel}
 */
function emptyModel() {
  return {
    mode: "practice",
    title: "",
    subtitle: "",
    questions: [],
    selected: {},
    index: 0,
    locked: false,
    score: 0,
    total: 0,
    banner: "",
    backRoute: "/practice",
    backLabel: "Quay lại",
    showSubmit: false,
    showRetry: false,
    showTimer: false,
    remainingSeconds: 0,
    urgent: false,
    saveNote: "",
  };
}

/**
 * @param {ExamModel} model
 */
function examMarkup(model) {
  const questionsHtml = model.locked
    ? model.questions.map(function (question, index) {
      return questionMarkup(model, question, index, true);
    }).join("")
    : questionMarkup(model, model.questions[model.index], model.index, false);
  const navButtons = model.locked
    ? ""
    : (
      '<div class="buttons exam-nav">' +
        '<button class="button" type="button" data-action="prev"' + (model.index === 0 ? " disabled" : "") + ">Câu trước</button>" +
        '<button class="button" type="button" data-action="next"' + (model.index >= model.questions.length - 1 ? " disabled" : "") + ">Câu tiếp theo</button>" +
      "</div>"
    );
  const banner = model.locked ? resultBannerMarkup(model) : "";
  const timer = model.showTimer
    ? '<div class="timer-box"><p id="timer" class="timer' + (model.urgent ? " is-urgent" : "") + '">' + formatClock(model.remainingSeconds) + '</p><p class="timer-label">Thời gian còn lại</p></div>'
    : (model.locked ? "" : '<div class="timer-box"><p class="timer">∞</p><p class="timer-label">Không giới hạn thời gian</p></div>');
  const submit = model.showSubmit
    ? '<button class="button is-primary is-fullwidth" type="button" data-action="submit">Nộp bài</button>'
    : "";
  const retry = model.showRetry
    ? '<button class="button is-primary" type="button" data-action="retry">Làm lại</button>'
    : "";
  const legend = model.locked
    ? '<p class="legend"><span><i class="swatch-right"></i>Đúng</span><span><i class="swatch-wrong"></i>Sai</span></p>'
    : '<p class="legend"><span><i class="swatch-answered"></i>Đã chọn</span></p>';
  const tabs = model.mode === "history" ? tabsMarkup("history") : "";
  return (
    tabs +
    '<div class="exam-layout">' +
      "<div>" +
        banner +
        questionsHtml +
        navButtons +
      "</div>" +
      '<aside class="card exam-side">' +
        '<div class="card-content">' +
          "<p class=\"exam-kicker\">" + escapeHtml(model.title) + "</p>" +
          '<p class="exam-sub">' + escapeHtml(model.subtitle) + "</p>" +
          timer +
          '<p id="progress" class="progress-label">' + escapeHtml(progressText(model.questions, model.selected)) + "</p>" +
          legend +
          '<div id="palette" class="q-grid">' + paletteMarkup(model) + "</div>" +
          submit +
          '<div class="side-actions">' +
            retry +
            '<button class="button" type="button" data-route="' + model.backRoute + '">' + escapeHtml(model.backLabel) + "</button>" +
          "</div>" +
        "</div>" +
      "</aside>" +
    "</div>"
  );
}

/**
 * @param {number} score
 * @param {number} total
 * @param {boolean} criticalMissed
 * @returns {boolean}
 */
function isPassed(score, total, criticalMissed) {
  return total === MOCK_SIZE && score >= PASS_SCORE && criticalMissed === false;
}

/**
 * @param {Question[]} questions
 * @param {SelectedMap} selected
 * @returns {boolean}
 */
function missedCritical(questions, selected) {
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (question.critical_question && selected[String(question.id)] !== question.correct_answer) return true;
  }
  return false;
}

/**
 * @param {Attempt} attempt
 * @returns {boolean}
 */
function attemptMissedCritical(attempt) {
  for (let index = 0; index < attempt.answers.length; index += 1) {
    const answer = attempt.answers[index];
    const question = questionById.get(answer.id);
    if (!question) continue;
    if (question.critical_question && answer.selected !== question.correct_answer) return true;
  }
  return false;
}

/**
 * @param {ExamModel} model
 */
function resultBannerMarkup(model) {
  if (model.total === MOCK_SIZE) {
    const passed = isPassed(model.score, model.total, missedCritical(model.questions, model.selected));
    const label = passed ? "Pass" : "Not Pass";
    const tone = passed ? "" : " is-fail";
    return (
      '<div class="result-banner is-centered' + tone + '">' +
        '<p class="result-score">' + model.score + "<small>/" + model.total + "</small></p>" +
        '<p class="result-status">' + label + "</p>" +
      "</div>"
    );
  }
  return (
    '<div class="result-banner">' +
      '<p class="result-score">' + model.score + "<small>/" + model.questions.length + "</small></p>" +
      '<div class="result-copy">' +
        "<p>" + escapeHtml(model.banner) + "</p>" +
        (model.saveNote ? "<p>" + escapeHtml(model.saveNote) + "</p>" : "") +
        "<p>Bên dưới là đáp án và giải thích của từng câu.</p>" +
      "</div>" +
    "</div>"
  );
}

/**
 * @param {ExamModel} model
 */
function paletteMarkup(model) {
  return model.questions.map(function (question, index) {
    const selected = model.selected[String(question.id)] || "";
    let className = "q-dot";
    if (!model.locked && index === model.index) className += " is-current";
    if (model.locked) {
      className += selected === question.correct_answer ? " is-right" : " is-wrong";
    } else if (selected !== "") {
      className += " is-answered";
    }
    if (model.locked) {
      return '<button class="' + className + '" type="button" data-action="jump" data-jump="review-' + index + '">' + (index + 1) + "</button>";
    }
    return '<button class="' + className + '" type="button" data-action="goto" data-index="' + index + '">' + (index + 1) + "</button>";
  }).join("");
}

/**
 * @typedef {Object} ExplainParts
 * @property {string} body
 * @property {string} tip
 * @property {string} critical
 */

/**
 * @param {string} explain
 * @returns {ExplainParts}
 */
function splitExplain(explain) {
  const criticalMark = /\(\s*Câu điểm liệt\s*[–—-]\s*bắt buộc nắm chắc\s*\)/;
  const critical = criticalMark.test(explain) ? "Câu điểm liệt. Bắt buộc nắm chắc." : "";
  let text = explain.replace(/\s*\(\s*Câu điểm liệt\s*[–—-]\s*bắt buộc nắm chắc\s*\)\.?/g, " ").replace(/\s{2,}/g, " ").trim();
  const easyTip = text.match(/\s*\(\s*Mẹo dễ nhớ\s*:\s*([^)]*)\)\s*\.?\s*$/);
  if (easyTip && typeof easyTip.index === "number") {
    return {
      body: tidyExplain(text.slice(0, easyTip.index)),
      tip: tidyExplain(easyTip[1] || ""),
      critical: critical,
    };
  }
  const marker = /(?:^|\s)Mẹo(?:\s+nhớ)?\s*:\s*/g;
  /** @type {RegExpExecArray | null} */
  let last = null;
  /** @type {RegExpExecArray | null} */
  let match = marker.exec(text);
  while (match) {
    last = match;
    match = marker.exec(text);
  }
  if (!last || typeof last.index !== "number" || last[0] === "") {
    return { body: tidyExplain(text), tip: "", critical: critical };
  }
  return {
    body: tidyExplain(text.slice(0, last.index)),
    tip: tidyExplain(text.slice(last.index + last[0].length)),
    critical: critical,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function tidyExplain(value) {
  return value.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function richText(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/**
 * @param {string} explain
 * @returns {string}
 */
function explainMarkup(explain) {
  const parts = splitExplain(explain);
  const bodyHtml = parts.body === ""
    ? ""
    : '<p class="explain-body">' + richText(parts.body) + "</p>";
  const tipHtml = parts.tip === ""
    ? ""
    : '<p class="explain-tip"><span class="explain-tip-label">Mẹo nhớ.</span> ' + richText(parts.tip) + "</p>";
  const criticalHtml = parts.critical === ""
    ? ""
    : '<p class="explain-critical">' + escapeHtml(parts.critical) + "</p>";
  return (
    '<div class="explain-box">' +
      '<p class="explain-label">Giải thích chi tiết</p>' +
      bodyHtml +
      tipHtml +
      criticalHtml +
    "</div>"
  );
}

/**
 * @param {ExamModel} model
 * @param {Question | undefined} question
 * @param {number} index
 * @param {boolean} locked
 */
function questionMarkup(model, question, index, locked) {
  if (!question) return "";
  const selected = model.selected[String(question.id)] || "";
  const image = imagePath(question.image);
  const imageHtml = image === ""
    ? ""
    : '<div class="question-image"><img src="' + escapeHtml(image) + '" alt="Hình minh họa câu ' + question.id + '"></div>';
  const keys = Object.keys(question.answer).sort(function (left, right) {
    return Number(left) - Number(right);
  });
  const options = keys.map(function (key) {
    const text = question.answer[key] || "";
    let className = "option";
    let tags = "";
    if (locked) {
      if (key === question.correct_answer) {
        className += " is-correct";
        tags += '<span class="tag is-success is-light">Đáp án đúng</span>';
      }
      if (selected === key && key !== question.correct_answer) {
        className += " is-wrong";
        tags += '<span class="tag is-danger is-light">Bạn chọn</span>';
      }
      if (selected === key && key === question.correct_answer) {
        tags += '<span class="tag is-success is-light">Bạn chọn</span>';
      }
    } else if (selected === key) {
      className += " is-selected";
    }
    const tagHtml = tags === "" ? "" : '<span class="option-tags">' + tags + "</span>";
    return (
      '<label class="' + className + '">' +
        '<input type="radio" name="option-' + index + '" value="' + escapeHtml(key) + '"' +
          (selected === key ? " checked" : "") +
          (locked ? " disabled" : "") +
        ">" +
        '<span class="option-key">' + escapeHtml(key) + "</span>" +
        '<span class="option-body">' + escapeHtml(text) + tagHtml + "</span>" +
      "</label>"
    );
  }).join("");
  const explainHtml = locked ? explainMarkup(question.explain) : "";
  const criticalHtml = question.critical_question
    ? '<span class="critical-tag">Câu điểm liệt</span>'
    : "";
  const panelId = locked ? ' id="review-' + index + '"' : ' id="question-panel"';
  return (
    '<article class="card question-card"' + panelId + ">" +
      '<div class="card-content">' +
        '<div class="question-head">' +
          '<p class="question-kicker">Câu ' + (index + 1) + "/" + model.questions.length + " · câu số " + question.id + "</p>" +
          criticalHtml +
        "</div>" +
        '<h2 class="question-text">' + escapeHtml(question.question) + "</h2>" +
        imageHtml +
        options +
        explainHtml +
      "</div>" +
    "</article>"
  );
}

/**
 * @param {Question[]} questions
 * @param {SelectedMap} selected
 */
function progressText(questions, selected) {
  let answered = 0;
  questions.forEach(function (question) {
    if (selected[String(question.id)]) answered += 1;
  });
  return "Đã trả lời " + answered + "/" + questions.length;
}

/**
 * @param {Session} current
 */
function unansweredCount(current) {
  let missing = 0;
  current.questions.forEach(function (question) {
    if (!current.selected[String(question.id)]) missing += 1;
  });
  return missing;
}

/**
 * @param {Question[]} questions
 * @param {SelectedMap} selected
 */
function countScore(questions, selected) {
  let score = 0;
  questions.forEach(function (question) {
    if (selected[String(question.id)] === question.correct_answer) score += 1;
  });
  return score;
}

/**
 * @param {Question[]} questions
 * @param {number} count
 * @returns {Question[]}
 */
function pickRandom(questions, count) {
  const copy = questions.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy.slice(0, count);
}

/**
 * @param {number} endsAtMs
 * @param {number} nowMs
 */
function remainingSeconds(endsAtMs, nowMs) {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

/**
 * @param {string} title
 * @param {string} message
 * @param {() => void} onConfirm
 */
function openModal(title, message, onConfirm) {
  modalAction = onConfirm;
  $("#modal-title").text(title);
  $("#modal-message").text(message);
  $("#modal").addClass("is-active");
}

function closeModal() {
  modalAction = null;
  $("#modal").removeClass("is-active");
}

/**
 * @param {string} message
 * @param {boolean} isError
 */
function renderMessage(message, isError) {
  const kind = isError ? "is-danger" : "is-info";
  $("#view").html('<div class="container"><div class="notification ' + kind + ' is-light">' + escapeHtml(message) + "</div></div>");
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} image
 */
function imagePath(image) {
  return IMAGE_PATH.test(image) ? image : "";
}

/**
 * @param {number} seconds
 */
function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(remain).padStart(2, "0");
}

/**
 * @param {number} seconds
 */
function formatDuration(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  return minutes + " phút " + String(remain).padStart(2, "0") + " giây";
}

/**
 * @param {string} iso
 */
function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * @param {JsonValue} value
 * @returns {JsonObject | null}
 */
function asObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

/**
 * @param {JsonValue} value
 * @returns {Question[] | null}
 */
function parseQuestions(value) {
  if (!Array.isArray(value)) return null;
  /** @type {Question[]} */
  const questions = [];
  for (let index = 0; index < value.length; index += 1) {
    const question = parseQuestion(value[index]);
    if (!question) return null;
    questions.push(question);
  }
  return questions;
}

/**
 * @param {JsonValue} value
 * @returns {Question | null}
 */
function parseQuestion(value) {
  const record = asObject(value);
  if (!record) return null;
  const id = record.id;
  const text = record.question;
  const correct = record.correct_answer;
  const critical = record.critical_question;
  const image = record.image;
  const explain = record.explain;
  const answerValue = record.answer;
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (typeof correct !== "string") return null;
  if (typeof critical !== "boolean") return null;
  if (typeof explain !== "string" || explain.trim() === "") return null;
  if (typeof image !== "string") return null;
  const answerRecord = asObject(answerValue);
  if (!answerRecord) return null;
  /** @type {AnswerMap} */
  const answer = {};
  const keys = Object.keys(answerRecord);
  if (keys.length < 2) return null;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const item = answerRecord[key];
    if (!/^[1-9]$/.test(key) || typeof item !== "string") return null;
    answer[key] = item;
  }
  if (typeof answer[correct] !== "string") return null;
  return {
    id: id,
    question: text,
    answer: answer,
    correct_answer: correct,
    critical_question: critical,
    explain: explain.trim(),
    image: image,
  };
}

/**
 * @param {JsonValue} value
 * @returns {Attempt[]}
 */
function parseHistory(value) {
  const record = asObject(value);
  if (!record || !Array.isArray(record.attempts)) return [];
  /** @type {Attempt[]} */
  const list = [];
  record.attempts.forEach(function (item) {
    const attempt = parseAttempt(item);
    if (attempt) list.push(attempt);
  });
  return list;
}

/**
 * @param {JsonValue} value
 * @returns {Attempt | null}
 */
function parseAttempt(value) {
  const record = asObject(value);
  if (!record) return null;
  const id = record.id;
  const startedAt = record.startedAt;
  const submittedAt = record.submittedAt;
  const durationSeconds = record.durationSeconds;
  const score = record.score;
  const total = record.total;
  const expired = record.expired;
  if (typeof id !== "string" || id === "") return null;
  if (typeof startedAt !== "string" || typeof submittedAt !== "string") return null;
  if (typeof durationSeconds !== "number" || typeof score !== "number" || typeof total !== "number") return null;
  if (typeof expired !== "boolean") return null;
  if (!Array.isArray(record.answers)) return null;
  /** @type {AttemptAnswer[]} */
  const answers = [];
  for (let index = 0; index < record.answers.length; index += 1) {
    const row = asObject(record.answers[index]);
    if (!row || typeof row.id !== "number" || !Number.isInteger(row.id) || typeof row.selected !== "string") return null;
    answers.push({ id: row.id, selected: row.selected });
  }
  return {
    id: id,
    startedAt: startedAt,
    submittedAt: submittedAt,
    durationSeconds: durationSeconds,
    score: score,
    total: total,
    expired: expired,
    answers: answers,
  };
}
