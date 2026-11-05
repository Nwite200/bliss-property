// Adds reveal/copy controls beside password inputs. Secret-key fields are excluded.
(function () {
  function enhance(input) {
    if (!input || input.dataset.pwToggle === "1") return;
    if (["wemaSecretInput", "webhookSecretInput", "static_wallet_bvn"].includes(input.id)) return;
    input.dataset.pwToggle = "1";
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle";
    const eye = document.createElement("button");
    eye.type = "button";
    eye.textContent = "👁";
    eye.title = "Show / hide password";
    eye.setAttribute("aria-label", "Show or hide password");
    eye.style.cssText = "border:1px solid var(--line);background:#fff;border-radius:6px;padding:7px 9px;cursor:pointer;line-height:1";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "⧉";
    copy.title = "Copy password";
    copy.setAttribute("aria-label", "Copy password");
    copy.style.cssText = "border:1px solid var(--line);background:#fff;border-radius:6px;padding:7px 9px;cursor:pointer;line-height:1";
    eye.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      eye.textContent = showing ? "👁" : "🙈";
    });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(input.value || "");
        copy.textContent = "✓";
        setTimeout(() => { copy.textContent = "⧉"; }, 1200);
      } catch {
        input.select();
        document.execCommand("copy");
        copy.textContent = "✓";
        setTimeout(() => { copy.textContent = "⧉"; }, 1200);
      }
    });
    wrap.appendChild(eye);
    wrap.appendChild(copy);
    input.insertAdjacentElement("afterend", wrap);
  }
  function init() {
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
