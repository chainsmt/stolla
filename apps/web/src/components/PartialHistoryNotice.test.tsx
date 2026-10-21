import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartialHistoryNotice } from "./PartialHistoryNotice";
import type { PartialHistoryState } from "@/lib/proposal-index/hydrate";

const unavailable: PartialHistoryState = {
  reason: "indexer-unavailable",
  title: "Older proposal history is unavailable",
  message:
    "RPC retention does not reach the configured start ledger, and the proposal index could not be read. This page is not empty: proposals still inside the retention window stay listed.",
  action:
    "Retry the index. Live proposal state and votes continue to load from RPC.",
};

describe("PartialHistoryNotice", () => {
  it("shows an actionable partial-history state beside proposals that are still listed", async () => {
    const onRetry = vi.fn();
    render(
      <div>
        <PartialHistoryNotice state={unavailable} onRetry={onRetry} />
        <ul>
          <li>Recent proposal still on RPC</li>
        </ul>
      </div>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/unavailable/i);
    expect(screen.getByRole("status")).toHaveTextContent(/Retry the index/);
    expect(screen.getByRole("link", { name: /indexer boundary/i })).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("Recent proposal still on RPC");

    await userEvent.click(screen.getByRole("button", { name: /retry proposal index/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
