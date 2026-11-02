// Capture-safety and presentation helpers for the demo recording. The recorder
// fails rather than film a bad state.
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

export interface DemoReadyExpectations {
  /** Hash route without query, e.g. "#/jobs". */
  route: string;
  /** Page-specific h1 text (substring). */
  heading: string;
  /** Seeded content that must be visible (substrings). */
  content?: string[];
}

const LOADING_TEXT = /\bLoading\b|Comparing this listing|Opening your local|Working\.\.\./;

export async function waitForDemoReady(page: Page, expected: DemoReadyExpectations): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.location.hash.split("?")[0])).toBe(expected.route);
  await expect(page.locator("main h1").first()).toContainText(expected.heading);
  for (const text of expected.content ?? []) {
    await expect(page.locator("main").getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
  }
  await expect(page.locator('[data-testid="pwa-boot-screen"]')).toHaveCount(0);
  await expect.poll(async () => LOADING_TEXT.test(await page.locator("main").innerText())).toBe(false);
  expect((await page.locator("main").innerText()).trim().length, "main content is populated").toBeGreaterThan(200);
  await waitForLayoutStable(page);
}

/** Resolves once document size and scroll position have not changed for `settleMs`. */
export async function waitForLayoutStable(page: Page, settleMs = 600): Promise<void> {
  await page.evaluate(async (settle) => {
    await document.fonts.ready;
    const scroller = document.scrollingElement ?? document.documentElement;
    const snapshot = () => `${scroller.scrollHeight}:${scroller.scrollTop}:${document.querySelector("main")?.getBoundingClientRect().height}`;
    let last = snapshot();
    let stableSince = performance.now();
    while (performance.now() - stableSince < settle) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const next = snapshot();
      if (next !== last) {
        last = next;
        stableSince = performance.now();
      }
    }
  }, settleMs);
}

/**
 * Smoothly scrolls the element's nearest scroll container (the document, or the body of
 * an open dialog such as the assessment drawer) so the element's top sits `offset` px
 * below that container's top, then waits for the scroll to settle.
 */
export async function scrollToElement(page: Page, locator: Locator, offset = 24): Promise<void> {
  await locator.evaluate(async (element, off) => {
    const root = document.scrollingElement ?? document.documentElement;
    let scroller: Element = root;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        scroller = node;
        break;
      }
    }
    const containerTop = scroller === root ? 0 : scroller.getBoundingClientRect().top;
    const top = element.getBoundingClientRect().top - containerTop + scroller.scrollTop - off;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    let last = -1;
    let stableFrames = 0;
    while (stableFrames < 10) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      stableFrames = scroller.scrollTop === last ? stableFrames + 1 : 0;
      last = scroller.scrollTop;
    }
  }, offset);
  await waitForLayoutStable(page, 700);
}

/**
 * Restrained caption over the sidebar footer (the static blurb at the bottom
 * of the navigation), so it never covers product content.
 */
export async function caption(page: Page, text: string | null): Promise<void> {
  await page.evaluate((value) => {
    let bar = document.getElementById("demo-caption");
    if (!value) {
      if (bar) {
        bar.style.opacity = "0";
        setTimeout(() => bar?.remove(), 300);
      }
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      Object.assign(bar.style, {
        position: "fixed", left: "0px", bottom: "0px", width: "288px", minHeight: "215px", boxSizing: "border-box",
        display: "flex", alignItems: "center",
        zIndex: "2147483646", pointerEvents: "none", padding: "22px 24px", borderRadius: "0",
        background: "#f4fbf6", color: "#10261c",
        font: "600 18px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif",
        borderTop: "4px solid #2f7a55", opacity: "0", transition: "opacity 300ms ease",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = value;
    requestAnimationFrame(() => (bar!.style.opacity = "1"));
  }, text);
  await page.waitForTimeout(350);
}

/** Full-screen opening card, injected before the app's first paint and removed by `removeTitleCard`. */
export async function installTitleCard(context: BrowserContext, title: string, subtitle: string): Promise<void> {
  await context.addInitScript(
    ([heading, sub]) => {
      if (sessionStorage.getItem("demo-title-shown")) return;
      const mount = () => {
        if (document.getElementById("demo-title-card")) return;
        const card = document.createElement("div");
        card.id = "demo-title-card";
        Object.assign(card.style, {
          position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "18px", background: "#10261c", color: "#f4fbf6",
          transition: "opacity 600ms ease", fontFamily: "Georgia, 'Times New Roman', serif",
        });
        const h = document.createElement("div");
        h.textContent = heading;
        Object.assign(h.style, { fontSize: "52px", letterSpacing: "-0.01em", textAlign: "center", maxWidth: "1100px" });
        const s = document.createElement("div");
        s.textContent = sub;
        Object.assign(s.style, { font: "500 20px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif", opacity: "0.8" });
        card.append(h, s);
        document.documentElement.appendChild(card);
      };
      if (document.documentElement) mount();
      else document.addEventListener("readystatechange", mount, { once: true });
    },
    [title, subtitle] as const,
  );
}

export async function removeTitleCard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    sessionStorage.setItem("demo-title-shown", "1");
    const card = document.getElementById("demo-title-card");
    if (!card) throw new Error("title card missing");
    card.style.opacity = "0";
    await new Promise((resolve) => setTimeout(resolve, 650));
    card.remove();
  });
}

/** Visible cursor for the recording (headless video has none). */
export async function installCursor(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const mount = () => {
      if (document.getElementById("demo-cursor")) return;
      const dot = document.createElement("div");
      dot.id = "demo-cursor";
      Object.assign(dot.style, {
        position: "fixed", left: "-40px", top: "-40px", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px",
        borderRadius: "999px", background: "rgba(255, 255, 255, 0.4)", border: "2px solid rgba(16, 38, 28, 0.9)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)", zIndex: "2147483645", pointerEvents: "none", transition: "transform 120ms ease",
      });
      document.body.appendChild(dot);
      window.addEventListener("mousemove", (event) => {
        dot.style.left = `${event.clientX}px`;
        dot.style.top = `${event.clientY}px`;
      }, true);
      window.addEventListener("mousedown", () => (dot.style.transform = "scale(0.75)"), true);
      window.addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  });
}

/** Eases the cursor to the element's centre, then clicks it. */
export async function glideClick(page: Page, locator: Locator, steps = 18): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await waitForLayoutStable(page, 300);
  const box = await locator.boundingBox();
  if (!box) throw new Error("glideClick: target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
}

/** Eases the cursor to the element's centre without clicking. */
export async function glideTo(page: Page, locator: Locator, steps = 18): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await waitForLayoutStable(page, 300);
  const box = await locator.boundingBox();
  if (!box) throw new Error("glideTo: target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(200);
}

/**
 * Covers the viewport with a still of the current, fully rendered frame, so a
 * route change underneath is not filmed while the next page fetches its data.
 * The cursor and caption stay live above it.
 */
export async function freezeFrame(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById("demo-cursor")?.style.setProperty("visibility", "hidden"));
  const still = (await page.screenshot({ type: "jpeg", quality: 92 })).toString("base64");
  await page.evaluate((data) => {
    document.getElementById("demo-cursor")?.style.removeProperty("visibility");
    const img = document.createElement("img");
    img.id = "demo-freeze";
    img.src = `data:image/jpeg;base64,${data}`;
    Object.assign(img.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "2147483644", pointerEvents: "none", transition: "opacity 380ms ease" });
    document.documentElement.appendChild(img);
  }, still);
  await page.waitForFunction(() => (document.getElementById("demo-freeze") as HTMLImageElement | null)?.complete === true);
}

/** Instantly resets the document scroll (used under a frozen frame after a route change). */
export async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTo({ top: 0, behavior: "instant" }));
}

/** Cross-fades from the frozen still to the live, ready page. */
export async function releaseFrame(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const img = document.getElementById("demo-freeze");
    if (!img) throw new Error("no frozen frame to release");
    img.style.opacity = "0";
    await new Promise((resolve) => setTimeout(resolve, 420));
    img.remove();
  });
}
