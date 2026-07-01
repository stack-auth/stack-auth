// @vitest-environment jsdom

import type { HTMLAttributes, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutForm, TestModeBypassForm } from "./checkout";

const mockStripe = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
}));

const mockElements = vi.hoisted(() => ({
  submit: vi.fn(),
}));

const alertMock = vi.hoisted(() => vi.fn());
const locationAssignMock = vi.hoisted(() => vi.fn());

vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: () => <div>Payment details</div>,
  useElements: () => mockElements,
  useStripe: () => mockStripe,
}));

vi.mock("@/components/design-components/alert", () => ({
  DesignAlert: ({
    title,
    description,
    className: _className,
  }: {
    title?: ReactNode,
    description?: ReactNode,
    className?: string,
  }) => (
    <div role="alert">
      {title && <div>{title}</div>}
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock("@/components/design-components/card", () => ({
  DesignCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui", () => ({
  Typography: ({ children, className: _className }: { children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) => (
    <div>{children}</div>
  ),
}));

function renderCheckoutForm(props?: {
  setupSubscription?: () => Promise<string | null>,
  isFree?: boolean,
}) {
  return render(
    <CheckoutForm
      setupSubscription={props?.setupSubscription ?? vi.fn(async () => "client-secret")}
      stripeAccountId="acct_123"
      fullCode="purchase-code"
      disabled={false}
      chargesEnabled={true}
      isFree={props?.isFree ?? false}
    />,
  );
}

describe("checkout forms", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    alertMock.mockReset();
    locationAssignMock.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: locationAssignMock,
        origin: "http://localhost",
      },
    });
    mockElements.submit.mockResolvedValue({});
    mockStripe.confirmPayment.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockElements.submit.mockReset();
    mockStripe.confirmPayment.mockReset();
  });

  it("shows a blocking inline error when the test-mode bypass fails", async () => {
    render(
      <TestModeBypassForm
        onBypass={async () => {
          throw new Error("You already have this product and cannot purchase it again.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete test purchase" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not complete test purchase")).toBeTruthy();
    expect(screen.getByText("You already have this product and cannot purchase it again.")).toBeTruthy();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("clears a stale test-mode bypass error before retrying", async () => {
    const onBypass = vi.fn()
      .mockRejectedValueOnce(new Error("First failure"))
      .mockResolvedValueOnce(undefined);

    render(<TestModeBypassForm onBypass={onBypass} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete test purchase" }));
    expect(await screen.findByText("First failure")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Complete test purchase" }));

    await waitFor(() => {
      expect(screen.queryByText("First failure")).toBeNull();
    });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("shows Stripe Elements validation errors inline", async () => {
    const setupSubscription = vi.fn(async () => "client-secret");
    mockElements.submit.mockResolvedValueOnce({
      error: {
        message: "Enter a complete payment method.",
      },
    });

    renderCheckoutForm({ setupSubscription });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Enter a complete payment method.")).toBeTruthy();
    expect(setupSubscription).not.toHaveBeenCalled();
    expect(mockStripe.confirmPayment).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("shows purchase-session setup errors inline", async () => {
    const setupSubscription = vi.fn(async () => {
      throw new Error("New purchases are currently blocked for this project.");
    });

    renderCheckoutForm({ setupSubscription });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("New purchases are currently blocked for this project.")).toBeTruthy();
    expect(mockStripe.confirmPayment).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("shows Stripe confirmation failures inline", async () => {
    mockStripe.confirmPayment.mockResolvedValueOnce({
      error: {
        type: "card_error",
        message: "Your card was declined.",
      },
    });

    renderCheckoutForm();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Your card was declined.")).toBeTruthy();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("skips Stripe Elements for free checkout success", async () => {
    const setupSubscription = vi.fn(async () => null);

    renderCheckoutForm({ setupSubscription, isFree: true });

    expect(screen.queryByText("Payment details")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith("http://localhost/purchase/return?stripe_account_id=acct_123&purchase_full_code=purchase-code&free=1");
    });
    expect(setupSubscription).toHaveBeenCalledTimes(1);
    expect(mockElements.submit).not.toHaveBeenCalled();
    expect(mockStripe.confirmPayment).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("treats confirmPayment without an error as success", async () => {
    renderCheckoutForm();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mockStripe.confirmPayment).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("An unexpected error occurred.")).toBeNull();
    expect(alertMock).not.toHaveBeenCalled();
  });
});
