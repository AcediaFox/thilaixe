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
 * @typedef {"idle" | "saved" | "error"} SaveState
 */

/**
 * @typedef {"all" | "wrong" | "critical"} ReviewFilter
 */

/**
 * @typedef {Object} MockVerdict
 * @property {boolean} passed
 * @property {string} label
 * @property {string} reason
 */

/**
 * @typedef {Object} ReviewCounts
 * @property {number} wrong
 * @property {number} critical
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
 * @property {ExamMode | "history" | "bookmarks"} mode
 * @property {string} title
 * @property {string} subtitle
 * @property {Question[]} questions
 * @property {SelectedMap} selected
 * @property {number} index
 * @property {boolean} locked
 * @property {number} score
 * @property {number} total
 * @property {string} banner
 * @property {boolean} expired
 * @property {string} backRoute
 * @property {string} backLabel
 * @property {boolean} showSubmit
 * @property {boolean} showRetry
 * @property {boolean} showNewMock
 * @property {boolean} showTimer
 * @property {number} remainingSeconds
 * @property {boolean} urgent
 * @property {string} saveNote
 */

/**
 * @typedef {string | number | boolean | null | JsonValue[] | JsonObject} JsonValue
 * @typedef {{ [key: string]: JsonValue }} JsonObject
 */

const PRACTICE_SIZE = 100;
const PRACTICE_COUNT = 6;
const MOCK_SIZE = 30;
const PASS_SCORE = 27;
const MOCK_LIMIT_SECONDS = 20 * 60;
const IMAGE_PATH = /^images\/[0-9]+\.(jpg|png)$/;
const HISTORY_KEY = "thilaixe-history";
const BOOKMARK_KEY = "thilaixe-bookmarks";
const MOCK_USED_KEY = "thilaixe-mock-used";
const HISTORY_PAGE_SIZE = 5;

/** @type {Question[]} */
let bank = [];
/** @type {Question[][]} */
let practiceExams = [];
/** @type {Map<number, Question>} */
let questionById = new Map();
/** @type {Attempt[]} */
let attempts = [];
/** @type {number[]} */
let bookmarkIds = [];
/** @type {Set<number>} */
let mockUsedIds = new Set();
/** @type {Session | null} */
let session = null;
/** @type {number} */
let historyPage = 0;
/** @type {ReviewFilter} */
let reviewFilter = "all";
/** @type {string} */
let examHash = "";
/** @type {string} */
let pendingLeaveHash = "";
/** @type {boolean} */
let leavePromptOpen = false;
/** @type {(() => void) | null} */
let modalAction = null;

document.addEventListener("DOMContentLoaded", function () {
  bindEvents();
  boot();
});

/**
 * @param {Event} event
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function eventTarget(event, selector) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const match = target.closest(selector);
  if (match instanceof HTMLElement) return match;
  return null;
}

function bindEvents() {
  document.addEventListener("click", function (event) {
    const routeNode = eventTarget(event, "[data-route]");
    if (routeNode) {
      event.preventDefault();
      const route = routeNode.getAttribute("data-route");
      if (typeof route !== "string" || route === "") return;
      askLeave(route);
      return;
    }

    const actionNode = eventTarget(event, "[data-action]");
    if (!actionNode) return;
    const action = actionNode.getAttribute("data-action");
    if (action === "modal-close") {
      closeModal();
      return;
    }
    if (action === "bookmark") {
      const id = Number(actionNode.getAttribute("data-id"));
      if (!Number.isInteger(id) || !questionById.has(id)) return;
      toggleBookmark(id);
      const pointerClick = event instanceof MouseEvent && event.detail > 0;
      if (pointerClick && actionNode instanceof HTMLButtonElement) actionNode.blur();
      if (readRoute().name === "bookmarks") {
        render();
        return;
      }
      const on = isBookmarked(id);
      actionNode.classList.toggle("is-on", on);
      actionNode.setAttribute("aria-pressed", on ? "true" : "false");
      actionNode.setAttribute("aria-label", (on ? "Bỏ đánh dấu câu " : "Đánh dấu câu ") + id);
      return;
    }
    if (action === "start-practice") {
      const examNumber = Number(actionNode.getAttribute("data-exam"));
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
    if (action === "new-mock") {
      startMock();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "history-page") {
      const page = Number(actionNode.getAttribute("data-page"));
      const pageCount = Math.ceil(attempts.length / HISTORY_PAGE_SIZE);
      if (!Number.isInteger(page) || page < 0 || page >= pageCount || page === historyPage) return;
      historyPage = page;
      render();
      window.scrollTo(0, 0);
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
      const index = Number(actionNode.getAttribute("data-index"));
      if (Number.isInteger(index)) setIndex(index);
      return;
    }
    if (action === "review-filter") {
      const filter = parseReviewFilter(actionNode.getAttribute("data-filter") || "");
      if (!filter || filter === reviewFilter) return;
      reviewFilter = filter;
      render();
      const anchor = document.getElementById("review-filter");
      if (anchor) anchor.scrollIntoView({ block: "start" });
      return;
    }
    if (action === "jump") {
      const jumpId = actionNode.getAttribute("data-jump");
      const index = Number(actionNode.getAttribute("data-index"));
      if (typeof jumpId !== "string" || !Number.isInteger(index)) return;
      const model = currentExamModel();
      if (model) {
        const question = model.questions[index];
        if (question && !reviewQuestionVisible(question, model.selected)) {
          reviewFilter = "all";
          render();
        }
      }
      const target = document.getElementById(jumpId);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const view = document.getElementById("view");
  if (view) {
    view.addEventListener("change", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
      if (!target.closest("#question-panel")) return;
      if (!session || session.submitted) return;
      const question = session.questions[session.index];
      const selected = target.value;
      if (!question || typeof question.answer[selected] !== "string") return;
      session.selected[String(question.id)] = selected;
      paintLiveChrome();
    });
  }

  document.addEventListener("keydown", function (event) {
    const modal = document.getElementById("modal");
    if (modal && modal.classList.contains("is-active")) {
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
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  const modalOk = document.getElementById("modal-ok");
  if (modalOk) {
    modalOk.addEventListener("click", function () {
      const action = modalAction;
      closeModal();
      if (action) action();
    });
  }

  window.addEventListener("hashchange", function () {
    if (leavePromptOpen) return;
    if (session && !session.submitted && location.hash !== examHash) {
      pendingLeaveHash = location.hash;
      leavePromptOpen = true;
      history.pushState(null, "", examHash);
      openModal("Thoát bài", "Bài đang làm sẽ không được lưu. Bạn có chắc muốn thoát?", function () {
        const next = pendingLeaveHash;
        pendingLeaveHash = "";
        destroySession();
        if (location.hash === next) {
          render();
          return;
        }
        location.hash = next;
      });
      return;
    }
    if (!session) reviewFilter = "all";
    render();
  });

  window.addEventListener("beforeunload", function (event) {
    if (!session || session.submitted) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function boot() {
  const questions = parseQuestions(readQuestionBank());
  if (!questions || questions.length === 0) {
    renderMessage("Không đọc được bộ câu hỏi.");
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
  bookmarkIds = readBookmarks().filter(function (id) {
    return questionById.has(id);
  });
  mockUsedIds = loadMockUsedIds();
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

/**
 * @returns {number[]}
 */
function readBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    /** @type {number[]} */
    const ids = [];
    value.forEach(function (item) {
      if (typeof item === "number" && Number.isInteger(item) && item > 0 && ids.indexOf(item) === -1) {
        ids.push(item);
      }
    });
    return ids;
  } catch {
    return [];
  }
}

/**
 * @param {number[]} ids
 * @returns {boolean}
 */
function writeBookmarks(ids) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Set<number>}
 */
function loadMockUsedIds() {
  const stored = readMockUsed();
  if (stored === null) {
    const seeded = usedIdsFromLatestAttempt();
    mockUsedIds = seeded;
    writeMockUsed();
    return seeded;
  }
  /** @type {Set<number>} */
  const ids = new Set();
  stored.forEach(function (id) {
    if (questionById.has(id)) ids.add(id);
  });
  return ids;
}

/**
 * @returns {number[] | null}
 */
function readMockUsed() {
  try {
    const raw = localStorage.getItem(MOCK_USED_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    /** @type {number[]} */
    const ids = [];
    value.forEach(function (item) {
      if (typeof item === "number" && Number.isInteger(item) && item > 0 && ids.indexOf(item) === -1) {
        ids.push(item);
      }
    });
    return ids;
  } catch {
    return [];
  }
}

/**
 * @returns {Set<number>}
 */
function usedIdsFromLatestAttempt() {
  /** @type {Set<number>} */
  const ids = new Set();
  const latest = attempts[0];
  if (!latest) return ids;
  latest.answers.forEach(function (answer) {
    if (questionById.has(answer.id)) ids.add(answer.id);
  });
  return ids;
}

/**
 * @returns {boolean}
 */
function writeMockUsed() {
  try {
    const ids = Array.from(mockUsedIds);
    localStorage.setItem(MOCK_USED_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} id
 * @returns {boolean}
 */
function isBookmarked(id) {
  return bookmarkIds.indexOf(id) !== -1;
}

/**
 * @param {number} id
 */
function toggleBookmark(id) {
  const index = bookmarkIds.indexOf(id);
  if (index === -1) bookmarkIds.push(id);
  else bookmarkIds.splice(index, 1);
  writeBookmarks(bookmarkIds);
}

/**
 * @param {string} html
 */
function showView(html) {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = html;
}

function render() {
  updateNav();
  if (session) {
    showView(page(examMarkup(sessionModel())));
    return;
  }
  const route = readRoute();
  if (route.name === "mock") {
    showView(page(mockMarkup()));
    return;
  }
  if (route.name === "history" && route.attemptId !== "") {
    showView(page(historyDetailMarkup(route.attemptId)));
    return;
  }
  if (route.name === "history") {
    showView(page(historyMarkup()));
    return;
  }
  if (route.name === "bookmarks") {
    showView(page(bookmarkMarkup()));
    return;
  }
  showView(page(practiceMarkup()));
}

/**
 * @returns {{ name: "practice" | "mock" | "history" | "bookmarks", attemptId: string }}
 */
function readRoute() {
  const parts = (location.hash || "").replace(/^#/, "").split("/").filter(function (part) {
    return part !== "";
  });
  if (parts[0] === "mock") return { name: "mock", attemptId: "" };
  if (parts[0] === "history") return { name: "history", attemptId: parts[1] || "" };
  if (parts[0] === "bookmarks") return { name: "bookmarks", attemptId: "" };
  return { name: "practice", attemptId: "" };
}

function updateNav() {
  const route = readRoute();
  const active = session
    ? (session.mode === "practice" ? "practice" : "mock")
    : route.name;
  document.querySelectorAll("[data-nav]").forEach(function (node) {
    if (!(node instanceof HTMLElement)) return;
    const key = node.getAttribute("data-nav");
    node.classList.toggle("is-active", key === active);
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
      "<p class=\"page-lead\">6 đề, mỗi đề 100 câu theo thứ tự bộ 600 câu. Làm xong bấm nộp bài để chấm điểm, xem đáp án và phần giải thích chi tiết kèm mẹo nhớ.</p>" +
    "</header>" +
    '<div class="exam-grid">' + cards + "</div>"
  );
}

function mockMarkup() {
  return (
    '<div class="card mock-panel">' +
      '<div class="card-content">' +
        '<p class="exam-kicker">Đề ngẫu nhiên</p>' +
        "<h1 class=\"page-title\">Thi thử</h1>" +
        '<p class="page-lead">Một đề lấy ngẫu nhiên từ toàn bộ 600 câu.</p>' +
        '<ul class="rule-list">' +
          "<li>30 câu, không trùng nhau và không trùng các đề thi thử trước.</li>" +
          "<li>Đủ khoảng 20 đề thì bắt đầu vòng câu hỏi mới.</li>" +
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

function bookmarkMarkup() {
  /** @type {Question[]} */
  const questions = [];
  bookmarkIds.forEach(function (id) {
    const question = questionById.get(id);
    if (question) questions.push(question);
  });
  const lead = questions.length === 0
    ? "Trong luyện thi, bấm ngôi sao ở mỗi câu để lưu vào đây."
    : questions.length + " câu đã đánh dấu. Bấm lại ngôi sao để bỏ.";
  const head = (
    '<header class="page-head">' +
      '<h1 class="page-title">Câu đánh dấu</h1>' +
      '<p class="page-lead">' + escapeHtml(lead) + "</p>" +
    "</header>"
  );
  if (questions.length === 0) {
    return head + '<div class="empty-state">Chưa có câu nào được đánh dấu.</div>';
  }
  const model = bookmarkModel(questions);
  const cards = questions.map(function (question, index) {
    return questionMarkup(model, question, index, true);
  }).join("");
  return head + cards;
}

/**
 * @param {Question[]} questions
 * @returns {ExamModel}
 */
function bookmarkModel(questions) {
  return {
    mode: "bookmarks",
    title: "Câu đánh dấu",
    subtitle: "",
    questions: questions,
    selected: {},
    index: 0,
    locked: true,
    score: 0,
    total: questions.length,
    banner: "",
    expired: false,
    backRoute: "/bookmarks",
    backLabel: "Câu đánh dấu",
    showSubmit: false,
    showRetry: false,
    showNewMock: false,
    showTimer: false,
    remainingSeconds: 0,
    urgent: false,
    saveNote: "",
  };
}

function historyMarkup() {
  if (attempts.length === 0) {
    return (
      '<header class="page-head">' +
        "<h1 class=\"page-title\">Lịch sử thi thử</h1>" +
      "</header>" +
      '<div class="empty-state">Chưa có lần thi nào.</div>'
    );
  }
  const pageCount = Math.ceil(attempts.length / HISTORY_PAGE_SIZE);
  if (historyPage > pageCount - 1) historyPage = pageCount - 1;
  const start = historyPage * HISTORY_PAGE_SIZE;
  const visible = attempts.slice(start, start + HISTORY_PAGE_SIZE);
  const items = visible.map(function (attempt, index) {
    const tone = isPassed(attempt.score, attempt.total, attemptMissedCritical(attempt)) ? " is-pass" : " is-fail";
    const round = attempts.length - (start + index);
    return (
      '<a class="history-item' + tone + '" href="#/history/' + escapeHtml(attempt.id) + '" data-route="/history/' + escapeHtml(attempt.id) + '">' +
        '<span class="history-round">Thi lần ' + round + "</span>" +
        '<span class="history-score">' + attempt.score + "<small>/" + attempt.total + "</small></span>" +
        '<span class="history-meta">' +
          escapeHtml(formatDateTime(attempt.submittedAt)) +
          " · " + escapeHtml(formatDuration(attempt.durationSeconds)) +
        "</span>" +
      "</a>"
    );
  }).join("");
  const pager = attempts.length > HISTORY_PAGE_SIZE ? historyPagerMarkup(historyPage, pageCount) : "";
  const listClass = pager === "" ? "history-list" : "history-list is-paged";
  return (
    '<header class="page-head">' +
      "<h1 class=\"page-title\">Lịch sử thi thử</h1>" +
      '<p class="page-lead">Chọn một lần làm để xem chi tiết đáp án.</p>' +
    "</header>" +
    '<div class="' + listClass + '">' + items + "</div>" +
    pager
  );
}

/**
 * @param {number} page
 * @param {number} pageCount
 * @returns {string}
 */
function historyPagerMarkup(page, pageCount) {
  let numbers = "";
  for (let index = 0; index < pageCount; index += 1) {
    const current = index === page ? " is-current" : "";
    numbers += '<button class="button history-page' + current + '" type="button" data-action="history-page" data-page="' + index + '"' + (index === page ? ' aria-current="page"' : "") + ">" + (index + 1) + "</button>";
  }
  const prevDisabled = page === 0 ? " disabled" : "";
  const nextDisabled = page >= pageCount - 1 ? " disabled" : "";
  return (
    '<nav class="history-pager" aria-label="Phân trang lịch sử">' +
      '<button class="button history-page" type="button" data-action="history-page" data-page="' + (page - 1) + '"' + prevDisabled + ">Trước</button>" +
      numbers +
      '<button class="button history-page" type="button" data-action="history-page" data-page="' + (page + 1) + '"' + nextDisabled + ">Sau</button>" +
    "</nav>"
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
      '<div class="notification is-warning is-light">Không tìm thấy bài làm này.</div>' +
      '<a class="button" href="#/history" data-route="/history">Quay lại lịch sử</a>'
    );
  }
  return examMarkup(attemptModel(attempt));
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
    renderMessage("Bộ câu hỏi không đủ 30 câu để thi thử.");
    return;
  }
  destroySession();
  session = createSession("mock", pickMockQuestions(), 0);
  render();
}

/**
 * @returns {Question[]}
 */
function pickMockQuestions() {
  /** @type {Question[]} */
  let pool = bank.filter(function (question) {
    return !mockUsedIds.has(question.id);
  });
  if (pool.length < MOCK_SIZE) {
    mockUsedIds = new Set();
    pool = bank.slice();
  }
  const picked = pickRandom(pool, MOCK_SIZE);
  picked.forEach(function (question) {
    mockUsedIds.add(question.id);
  });
  writeMockUsed();
  return picked;
}

/**
 * @param {ExamMode} mode
 * @param {Question[]} questions
 * @param {number} examNumber
 * @returns {Session}
 */
function createSession(mode, questions, examNumber) {
  const startedMs = Date.now();
  examHash = location.hash;
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
  reviewFilter = "all";
  if (!session) return;
  if (session.timerId !== 0) window.clearInterval(session.timerId);
  session.timerId = 0;
  session = null;
  examHash = "";
}

function tickTimer() {
  if (!session || session.submitted || session.mode !== "mock") return;
  const remaining = remainingSeconds(session.endsAtMs, Date.now());
  const timer = document.getElementById("timer");
  if (timer) {
    timer.textContent = formatClock(remaining);
    timer.classList.toggle("is-urgent", remaining <= 60);
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
  document.querySelectorAll("#question-panel .option").forEach(function (node) {
    if (!(node instanceof HTMLElement)) return;
    const input = node.querySelector("input");
    const value = input instanceof HTMLInputElement ? input.value : "";
    node.classList.toggle("is-selected", value === selected);
  });
  const palette = document.getElementById("palette");
  if (palette) palette.innerHTML = paletteMarkup(sessionModel());
  const progress = document.getElementById("progress");
  if (progress) progress.textContent = progressText(session.questions, session.selected);
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
    expired: session.expired,
    backRoute: session.mode === "practice" ? "/practice" : "/mock",
    backLabel: session.mode === "practice" ? "Danh sách đề" : "Về thi thử",
    showSubmit: !session.submitted,
    showRetry: session.submitted,
    showNewMock: session.mode === "mock" && session.submitted,
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
    expired: attempt.expired,
    backRoute: "/history",
    backLabel: "Quay lại lịch sử",
    showSubmit: false,
    showRetry: false,
    showNewMock: false,
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
    expired: false,
    backRoute: "/practice",
    backLabel: "Quay lại",
    showSubmit: false,
    showRetry: false,
    showNewMock: false,
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
    ? lockedQuestionsMarkup(model)
    : questionMarkup(model, model.questions[model.index], model.index, false);
  const filterHtml = model.locked ? reviewFilterMarkup(model) : "";
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
  const newMock = model.showNewMock
    ? '<button class="button" type="button" data-action="new-mock">Đề mới</button>'
    : "";
  const legend = model.locked
    ? '<p class="legend"><span><i class="swatch-right"></i>Đúng</span><span><i class="swatch-wrong"></i>Sai</span></p>'
    : '<p class="legend"><span><i class="swatch-answered"></i>Đã chọn</span></p>';
  return (
    '<div class="exam-layout">' +
      "<div>" +
        banner +
        filterHtml +
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
            newMock +
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
 * @returns {MockVerdict}
 */
function mockVerdict(model) {
  const criticalMissed = missedCritical(model.questions, model.selected);
  const passed = isPassed(model.score, model.total, criticalMissed);
  const shortScore = model.score < PASS_SCORE;
  let reason = "Đủ " + PASS_SCORE + "/" + MOCK_SIZE + " và không sai câu điểm liệt.";
  if (!passed && criticalMissed && shortScore) {
    reason = "Sai câu điểm liệt nên không đạt. Cần đúng ít nhất " + PASS_SCORE + "/" + MOCK_SIZE + ".";
  } else if (!passed && criticalMissed) {
    reason = "Sai câu điểm liệt nên không đạt.";
  } else if (!passed) {
    reason = "Cần đúng ít nhất " + PASS_SCORE + "/" + MOCK_SIZE + ".";
  }
  if (model.expired) reason += " Hết giờ, bài đã được nộp tự động.";
  return {
    passed: passed,
    label: passed ? "Đạt" : "Không đạt",
    reason: reason,
  };
}

/**
 * @param {ExamModel} model
 * @returns {string}
 */
function resultBannerMarkup(model) {
  if (model.total === MOCK_SIZE) {
    const verdict = mockVerdict(model);
    const tone = verdict.passed ? "" : " is-fail";
    const note = model.saveNote === "" ? "" : "<p>" + escapeHtml(model.saveNote) + "</p>";
    return (
      '<div class="result-banner' + tone + '">' +
        '<p class="result-score">' + model.score + "<small>/" + model.total + "</small></p>" +
        '<div class="result-copy">' +
          '<p class="result-status">' + escapeHtml(verdict.label) + "</p>" +
          "<p>" + escapeHtml(verdict.reason) + "</p>" +
          note +
        "</div>" +
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
 * @param {string | undefined} value
 * @returns {ReviewFilter | null}
 */
function parseReviewFilter(value) {
  if (value === "all" || value === "wrong" || value === "critical") return value;
  return null;
}

/**
 * @returns {ExamModel | null}
 */
function currentExamModel() {
  if (session) return sessionModel();
  const route = readRoute();
  if (route.name !== "history" || route.attemptId === "") return null;
  const attempt = attempts.find(function (item) {
    return item.id === route.attemptId;
  });
  if (!attempt) return null;
  return attemptModel(attempt);
}

/**
 * @param {Question} question
 * @param {SelectedMap} selected
 * @returns {boolean}
 */
function reviewQuestionVisible(question, selected) {
  if (reviewFilter === "critical") return question.critical_question;
  if (reviewFilter === "wrong") return (selected[String(question.id)] || "") !== question.correct_answer;
  return true;
}

/**
 * @param {Question[]} questions
 * @param {SelectedMap} selected
 * @returns {ReviewCounts}
 */
function countReview(questions, selected) {
  let wrong = 0;
  let critical = 0;
  questions.forEach(function (question) {
    if (question.critical_question) critical += 1;
    if ((selected[String(question.id)] || "") !== question.correct_answer) wrong += 1;
  });
  return { wrong: wrong, critical: critical };
}

/**
 * @returns {string}
 */
function emptyReviewMessage() {
  if (reviewFilter === "wrong") return "Không có câu sai.";
  if (reviewFilter === "critical") return "Đề này không có câu điểm liệt.";
  return "Không có câu hỏi.";
}

/**
 * @param {ExamModel} model
 * @returns {string}
 */
function reviewFilterMarkup(model) {
  const counts = countReview(model.questions, model.selected);
  const allOn = reviewFilter === "all";
  const wrongOn = reviewFilter === "wrong";
  const criticalOn = reviewFilter === "critical";
  return (
    '<div id="review-filter" class="review-filter" role="group" aria-label="Lọc câu">' +
      '<button class="button' + (allOn ? " is-current" : "") + '" type="button" data-action="review-filter" data-filter="all" aria-pressed="' + (allOn ? "true" : "false") + '">Tất cả</button>' +
      '<button class="button' + (wrongOn ? " is-current" : "") + '" type="button" data-action="review-filter" data-filter="wrong" aria-pressed="' + (wrongOn ? "true" : "false") + '">Câu sai (' + counts.wrong + ")</button>" +
      '<button class="button' + (criticalOn ? " is-current" : "") + '" type="button" data-action="review-filter" data-filter="critical" aria-pressed="' + (criticalOn ? "true" : "false") + '">Điểm liệt (' + counts.critical + ")</button>" +
    "</div>"
  );
}

/**
 * @param {ExamModel} model
 * @returns {string}
 */
function lockedQuestionsMarkup(model) {
  /** @type {string[]} */
  const parts = [];
  model.questions.forEach(function (question, index) {
    if (!reviewQuestionVisible(question, model.selected)) return;
    parts.push(questionMarkup(model, question, index, true));
  });
  if (parts.length > 0) return parts.join("");
  return '<div class="empty-state">' + escapeHtml(emptyReviewMessage()) + "</div>";
}

/**
 * @param {ExamModel} model
 * @returns {string}
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
      return '<button class="' + className + '" type="button" data-action="jump" data-jump="review-' + index + '" data-index="' + index + '">' + (index + 1) + "</button>";
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
  const starHtml = model.mode === "practice" || model.mode === "bookmarks"
    ? starMarkup(question)
    : "";
  const sideHtml = criticalHtml === "" && starHtml === ""
    ? ""
    : '<div class="question-head-side">' + criticalHtml + starHtml + "</div>";
  const kicker = model.mode === "bookmarks"
    ? "Câu số " + question.id
    : "Câu " + (index + 1) + "/" + model.questions.length + " · câu số " + question.id;
  const panelId = locked ? ' id="review-' + index + '"' : ' id="question-panel"';
  return (
    '<article class="card question-card"' + panelId + ">" +
      '<div class="card-content">' +
        '<div class="question-head">' +
          '<p class="question-kicker">' + kicker + "</p>" +
          sideHtml +
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
 * @param {Question} question
 */
function starMarkup(question) {
  const on = isBookmarked(question.id);
  const label = (on ? "Bỏ đánh dấu câu " : "Đánh dấu câu ") + question.id;
  return (
    '<button class="star-btn' + (on ? " is-on" : "") + '" type="button" data-action="bookmark" data-id="' + question.id + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + label + '">' +
      '<span aria-hidden="true">★</span>' +
    "</button>"
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
  const titleNode = document.getElementById("modal-title");
  const messageNode = document.getElementById("modal-message");
  const modal = document.getElementById("modal");
  if (titleNode) titleNode.textContent = title;
  if (messageNode) messageNode.textContent = message;
  if (modal) modal.classList.add("is-active");
}

function closeModal() {
  modalAction = null;
  leavePromptOpen = false;
  const modal = document.getElementById("modal");
  if (modal) modal.classList.remove("is-active");
}

/**
 * @param {string} message
 */
function renderMessage(message) {
  showView('<div class="container"><div class="notification is-danger is-light">' + escapeHtml(message) + "</div></div>");
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
