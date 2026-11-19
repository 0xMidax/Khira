import { describe, expect, it } from "vitest";
import { describeRecurrence, nextRun, type Recurrence } from "./recurrence";

describe("recurrence helpers", () => {
  describe("nextRun", () => {
    describe("daily frequency", () => {
      it("schedules for later today if hour has not passed", () => {
        const r: Recurrence = { freq: "daily", interval: 1, hour: 14 };
        const after = new Date("2026-03-10T10:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-03-10T14:00:00.000Z");
      });

      it("schedules for tomorrow if hour has already passed", () => {
        const r: Recurrence = { freq: "daily", interval: 1, hour: 9 };
        const after = new Date("2026-03-10T12:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-03-11T09:00:00.000Z");
      });

      it("steps by interval when previous run is provided", () => {
        const r: Recurrence = { freq: "daily", interval: 3, hour: 9 };
        const previous = new Date("2026-03-10T09:00:00Z");
        const after = new Date("2026-03-10T10:00:00Z");
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-03-13T09:00:00.000Z");
      });

      it("skips missed slots when the job was down for daily interval", () => {
        const r: Recurrence = { freq: "daily", interval: 2, hour: 9 };
        const previous = new Date("2026-03-01T09:00:00Z");
        const after = new Date("2026-03-10T12:00:00Z");
        // Steps: March 3, 5, 7, 9, 11 (first strictly > after)
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-03-11T09:00:00.000Z");
      });
    });

    describe("weekly frequency", () => {
      it("schedules for the next matching weekday", () => {
        // 2026-03-11 is a Wednesday (day 3). weekday 5 = Friday
        const r: Recurrence = { freq: "weekly", interval: 1, weekday: 5, hour: 9 };
        const after = new Date("2026-03-11T10:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-03-13T09:00:00.000Z");
      });

      it("schedules next week if today is the target weekday but hour has passed", () => {
        // 2026-03-13 is Friday
        const r: Recurrence = { freq: "weekly", interval: 1, weekday: 5, hour: 9 };
        const after = new Date("2026-03-13T10:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-03-20T09:00:00.000Z");
      });

      it("steps by multi-week interval from previous run", () => {
        const r: Recurrence = { freq: "weekly", interval: 2, weekday: 1, hour: 9 };
        const previous = new Date("2026-03-09T09:00:00Z"); // Monday
        const after = new Date("2026-03-10T00:00:00Z");
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-03-23T09:00:00.000Z");
      });

      it("skips missed slots when weekly job was down", () => {
        const r: Recurrence = { freq: "weekly", interval: 1, weekday: 1, hour: 9 };
        const previous = new Date("2026-01-05T09:00:00Z");
        const after = new Date("2026-03-09T09:00:00Z");
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-03-16T09:00:00.000Z");
      });
    });

    describe("monthly frequency", () => {
      it("schedules for this month if monthDay is in the future", () => {
        const r: Recurrence = { freq: "monthly", interval: 1, monthDay: 15, hour: 10 };
        const after = new Date("2026-03-05T12:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-03-15T10:00:00.000Z");
      });

      it("schedules for next month if monthDay has passed", () => {
        const r: Recurrence = { freq: "monthly", interval: 1, monthDay: 15, hour: 10 };
        const after = new Date("2026-03-20T12:00:00Z");
        expect(nextRun(r, after).toISOString()).toBe("2026-04-15T10:00:00.000Z");
      });

      it("steps by interval months from previous run", () => {
        const r: Recurrence = { freq: "monthly", interval: 3, monthDay: 1, hour: 9 };
        const previous = new Date("2026-01-01T09:00:00Z");
        const after = new Date("2026-01-02T00:00:00Z");
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-04-01T09:00:00.000Z");
      });

      it("skips missed slots when monthly job was down", () => {
        const r: Recurrence = { freq: "monthly", interval: 1, monthDay: 15, hour: 9 };
        const previous = new Date("2025-01-15T09:00:00Z");
        const after = new Date("2026-03-15T09:00:00Z");
        expect(nextRun(r, after, previous).toISOString()).toBe("2026-04-15T09:00:00.000Z");
      });
    });
  });

  describe("describeRecurrence", () => {
    it("describes daily recurrences with interval 1 and > 1", () => {
      expect(describeRecurrence({ freq: "daily", interval: 1, hour: 9 })).toBe(
        "Every day at 09:00 UTC"
      );
      expect(describeRecurrence({ freq: "daily", interval: 3, hour: 14 })).toBe(
        "Every 3 days at 14:00 UTC"
      );
    });

    it("describes weekly recurrences with weekday names", () => {
      expect(describeRecurrence({ freq: "weekly", interval: 1, weekday: 1, hour: 9 })).toBe(
        "Every week on Monday at 09:00 UTC"
      );
      expect(describeRecurrence({ freq: "weekly", interval: 2, weekday: 5, hour: 18 })).toBe(
        "Every 2 weeks on Friday at 18:00 UTC"
      );
      expect(describeRecurrence({ freq: "weekly", interval: 1, weekday: 0 })).toBe(
        "Every week on Sunday at 09:00 UTC"
      );
    });

    it("describes monthly recurrences with month day", () => {
      expect(describeRecurrence({ freq: "monthly", interval: 1, monthDay: 1, hour: 9 })).toBe(
        "Every month on day 1 at 09:00 UTC"
      );
      expect(describeRecurrence({ freq: "monthly", interval: 6, monthDay: 28, hour: 12 })).toBe(
        "Every 6 months on day 28 at 12:00 UTC"
      );
    });
  });
});
