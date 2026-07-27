const form = document.getElementById("qimen-form");
const errorBox = document.getElementById("q-error");
const chartSection = document.getElementById("chart");
const result = document.getElementById("result");
const palaceOrder = [4, 9, 2, 3, 5, 7, 8, 1, 6];

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const original = button.textContent;
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "布列九宫中…";
  try {
    const response = await fetch("/api/qimen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: document.getElementById("q-date").value,
        time: document.getElementById("q-time").value,
        consent: document.getElementById("q-consent").checked,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "奇门起局失败");
    renderQimen(payload);
    chartSection.hidden = false;
    chartSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

function renderQimen(payload) {
  const chart = payload.chart;
  const summary = el("div", "summary");
  [
    chart.juShu.jieQiName,
    chart.juShu.fullName,
    `值符 ${chart.zhiFu.star}`,
    `值使 ${chart.zhiShi.door}`,
  ].forEach((text) => summary.append(el("span", "pill", text)));

  const grid = el("div", "qimen-grid");
  palaceOrder
    .map((number) => chart.palaces.find((palace) => palace.number === number))
    .forEach((palace) => {
      const isKey =
        String(palace.number) === chart.zhiFu.palace ||
        String(palace.number) === chart.zhiShi.palace;
      const card = el("article", "palace" + (isKey ? " key" : ""));
      const title = el("h3");
      title.append(
        el("span", "", palace.name + palace.number + "宫"),
        el("span", "", palace.direction),
      );
      card.append(title);
      card.append(
        el(
          "p",
          "",
          `天盘 ${palace.heavenStem || "—"}　地盘 ${palace.earthStem || "—"}　暗干 ${palace.hiddenStem || "—"}`,
        ),
      );
      card.append(
        el(
          "p",
          "",
          `${palace.star || "—"} · ${palace.door || "—"} · ${palace.deity || "—"}`,
        ),
      );
      if (palace.isEmpty || palace.isHorse) {
        card.append(
          el(
            "p",
            "",
            (palace.isEmpty ? "空亡 " : "") + (palace.isHorse ? "驿马" : ""),
          ),
        );
      }
      grid.append(card);
    });
  result.replaceChildren(summary, grid, reportDetails(payload.report));
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
