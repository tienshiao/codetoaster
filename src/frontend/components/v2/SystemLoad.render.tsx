import { test, expect, describe, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SystemLoadIndicator, type SystemLoadReading } from "./SystemLoad";
import { ExplorerRail } from "./ExplorerRail";

/**
 * The rail's load meter and its card (TASK-149).
 *
 * Fixture readings two seconds apart, as the daemon sends them. What is
 * asserted is what a reader gets: the figure, the "high" that is not colour
 * alone, and a card with the chart and the numbers that opens on the pointer
 * and on keyboard focus.
 */

const T0 = 1_700_000_000_000;

function readings(cpus: (number | null)[], load: [number, number, number] = [2.5, 1.75, 1.2]) {
  return cpus.map<SystemLoadReading>((cpu, i) => ({ at: T0 + i * 2_000, cpu, load, cores: 10 }));
}

function meter() {
  return screen.getByRole("meter", { name: "System load" });
}

describe("the indicator", () => {
  test("shows the newest CPU figure, as text and as the meter's value", () => {
    render(<SystemLoadIndicator samples={readings([10, 20, 42.6])} intervalMs={2_000} capacity={300} />);

    screen.getByText("43%");
    expect(meter().getAttribute("aria-valuenow")).toBe("42.6");
    expect(meter().getAttribute("aria-valuetext")).toBe("CPU 43%");
    expect(meter().dataset.high).toBeUndefined();
  });

  test("high load is said in words and a box, not only a colour", () => {
    render(<SystemLoadIndicator samples={readings([40, 90])} intervalMs={2_000} capacity={300} />);

    expect(meter().getAttribute("aria-valuetext")).toBe("CPU 90%, high");
    expect(meter().dataset.high).toBe("true");
    const figure = screen.getByText("90%");
    // The non-colour half: the figure is boxed and set bold.
    expect(figure.className).toContain("font-semibold");
    expect(figure.className).toContain("outline");
  });

  test("before the daemon has said anything it is a dash, with no value claimed", () => {
    render(<SystemLoadIndicator samples={[]} intervalMs={2_000} capacity={300} />);

    screen.getByText("–");
    expect(meter().hasAttribute("aria-valuenow")).toBe(false);
    expect(meter().getAttribute("aria-valuetext")).toBe("CPU not measured yet");
  });

  test("is focusable, so the card has a keyboard way in", () => {
    render(<SystemLoadIndicator samples={readings([10])} intervalMs={2_000} capacity={300} />);
    expect(meter().tabIndex).toBe(0);
  });

  test("sits at the foot of the rail, after the sections", () => {
    render(
      <ExplorerRail
        items={[]}
        footer={<SystemLoadIndicator samples={readings([10])} intervalMs={2_000} capacity={300} />}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Explorer" });
    expect(nav.lastElementChild?.contains(meter())).toBe(true);
  });
});

describe("the card", () => {
  function open(cpus: (number | null)[]) {
    render(
      <SystemLoadIndicator open samples={readings(cpus, [3.14, 2.5, 1])} intervalMs={2_000} capacity={300} />,
    );
  }

  test("charts the window, with a summary a screen reader can read", () => {
    open([12, 30, 96, 55]);

    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toBe(
      "CPU over the last 10 min: low 12%, peak 96%, now 55%",
    );
    // One unbroken run: a line and the wash under it, plus the end dot.
    expect(chart.querySelectorAll("path")).toHaveLength(2);
    expect(chart.querySelectorAll("circle")).toHaveLength(1);
    screen.getByText("10 min ago");
    screen.getByText("now");
  });

  test("states the current figure, the peak, the load averages and the cores", () => {
    open([12, 30, 96, 55]);

    screen.getByText("55% CPU");
    screen.getByText("96%");
    screen.getByText("3.14 / 2.50 / 1.00");
    screen.getByText(/1, 5, 15 min/);
    screen.getByText("10");
  });

  test("says high in its heading when it is", () => {
    open([12, 85]);
    screen.getByText("85% CPU · high");
  });

  test("an unmeasured interval breaks the line rather than bridging it", () => {
    open([10, 20, null, 30, 40]);

    // Two runs, each a line and a wash.
    expect(screen.getByRole("img").querySelectorAll("path")).toHaveLength(4);
  });

  test("nothing of it is in the document until it opens", () => {
    render(<SystemLoadIndicator samples={readings([10])} intervalMs={2_000} capacity={300} />);
    expect(screen.queryByText("System load")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("what opens it", () => {
  function mountLive() {
    vi.useFakeTimers();
    render(<SystemLoadIndicator samples={readings([10, 20])} intervalMs={2_000} capacity={300} />);
    return meter();
  }

  afterEach(() => vi.useRealTimers());

  test("the pointer does", () => {
    const m = mountLive();
    fireEvent.pointerEnter(m, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(500));

    screen.getByText("System load");
    screen.getByRole("img");
  });

  test("keyboard focus does too — unlike a task row's card", () => {
    const m = mountLive();
    act(() => m.focus());
    act(() => void vi.advanceTimersByTime(500));

    expect(document.activeElement).toBe(m);
    screen.getByText("System load");
    screen.getByText("20% CPU");
  });
});
