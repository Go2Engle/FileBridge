import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/theme-toggle";

// Mock next-themes
const setThemeMock = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

describe("ThemeToggle", () => {
  it("renders the toggle button with accessible label", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByText("Toggle theme")).toBeInTheDocument();
  });

  it("opens the dropdown menu on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("calls setTheme('light') when Light is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Light"));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("calls setTheme('dark') when Dark is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Dark"));
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme('system') when System is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("System"));
    expect(setThemeMock).toHaveBeenCalledWith("system");
  });
});
