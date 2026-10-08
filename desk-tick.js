let timer = 0;

onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "arm") {
    clearInterval(timer);
    const ms = Number(data.ms);
    timer = setInterval(() => {
      postMessage({ type: "tick" });
    }, Number.isFinite(ms) && ms >= 1000 ? ms : 4000);
  }
  if (data.type === "stop") {
    clearInterval(timer);
  }
};
