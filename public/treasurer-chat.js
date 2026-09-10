(function () {
  if (document.getElementById("treasurer-assist-widget")) return;

  var script = document.currentScript;
  var scriptOrigin = new URL(script.src).origin;
  var widgetUrl = script.dataset.widgetUrl || scriptOrigin;
  var widgetOrigin = new URL(widgetUrl, document.baseURI).origin;
  var frame = document.createElement("iframe");

  frame.id = "treasurer-assist-widget";
  frame.title = "Treasurer Assist virtual assistant";
  frame.src = widgetUrl;
  frame.allow = "clipboard-write";
  frame.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "width:250px",
    "height:86px",
    "border:0",
    "background:transparent",
    "z-index:2147483000",
    "color-scheme:light",
  ].join(";");

  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow || event.origin !== widgetOrigin) return;
    if (!event.data || event.data.type !== "treasurer-chat:resize") return;

    if (event.data.open) {
      frame.style.width = "min(430px, 100vw)";
      frame.style.height = "min(720px, 100dvh)";
      frame.style.right = "0";
      frame.style.bottom = "0";
    } else {
      frame.style.width = "250px";
      frame.style.height = "86px";
      frame.style.right = "12px";
      frame.style.bottom = "12px";
    }
  });

  document.body.appendChild(frame);
})();