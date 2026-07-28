const form = document.getElementById("ziwei-form");
const errorBox = document.getElementById("z-error");
const chartSection = document.getElementById("ziwei-chart");
const result = document.getElementById("ziwei-result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const original = button.textContent;
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "推演十二宫中…";
  try {
    const response = await fetch("/api/ziwei", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: document.getElementById("z-date").value,
        time: document.getElementById("z-time").value,
        gender: document.getElementById("z-gender").value,
        consent: document.getElementById("z-consent").checked,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "紫微排盘失败");
    renderZiwei(payload);
    chartSection.hidden = false;
    chartSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

function renderZiwei(payload) {
  const chart = payload.chart;
  const summary = el("div", "summary");
  [
    chart.lunarDate,
    chart.timeLabel,
    `命主 ${chart.soul}`,
    `身主 ${chart.body}`,
    chart.fiveElementsClass,
  ].forEach((text) => summary.append(el("span", "pill", text)));

  const grid = el("div", "palace-grid");
  chart.palaces.forEach((palace) => {
    const card = el(
      "article",
      "palace" + (palace.name === "命宫" ? " soul" : ""),
    );
    const title = el("h3");
    title.append(
      el("span", "", palace.name),
      el("span", "", palace.heavenlyStem + palace.earthlyBranch),
    );
    card.append(title);
    card.append(
      el(
        "p",
        "",
        "主星：" + (palace.majorStars.map(starText).join("、") || "无主星"),
      ),
    );
    card.append(
      el(
        "p",
        "",
        "辅星：" + (palace.minorStars.map(starText).join("、") || "—"),
      ),
    );
    if (palace.isBodyPalace) card.append(el("p", "", "◎ 身宫同宫"));
    grid.append(card);
  });
  result.replaceChildren(summary, grid, reportDetails(payload.report));
}

function starText(star) {
  return (
    star.name +
    (star.brightness ? `〔${star.brightness}〕` : "") +
    (star.mutagen ? `·化${star.mutagen}` : "")
  );
}

function reportDetails(text) {
  const box = document.createElement("details");
  box.className = "report-details";
  const summary = document.createElement("summary");
  summary.textContent = "查看完整结构报告与算法边界";
  const pre = document.createElement("pre");
  pre.textContent = text;
  box.append(summary, pre);
  return box;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
