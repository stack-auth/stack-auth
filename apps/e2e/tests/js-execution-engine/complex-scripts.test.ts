import { it, describe, expect, beforeAll } from "vitest";

const JS_EXECUTION_ENGINE_URL = "http://localhost:8124";
const JS_EXECUTION_ENGINE_SECRET = "dev-secret-placeholder-123456";

describe("JS Execution Engine - Complex Scripts", () => {
  beforeAll(async () => {
    // Wait for service to be ready
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/health`, {
          headers: {
            Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
          },
        });
        if (response.ok) break;
      } catch {
        // Service not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  it("should execute the factorial example from the spec", async () => {
    const script = `
      // get the value of the factorials of the numbers from 1 to 10 combined
      const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      function factorial(n) {
        if (n === 0) {
          return 1;
        }
        return n * factorial(n - 1);
      }

      const b = a.map(factorial);

      return b.reduce((a, b) => a + b);
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    // 1! + 2! + 3! + 4! + 5! + 6! + 7! + 8! + 9! + 10!
    // = 1 + 2 + 6 + 24 + 120 + 720 + 5040 + 40320 + 362880 + 3628800
    // = 4037913
    expect(body.result).toBe(4037913);
  });

  it("should execute array operations", async () => {
    const script = `
      const numbers = [1, 2, 3, 4, 5];
      const doubled = numbers.map(n => n * 2);
      const sum = doubled.reduce((acc, n) => acc + n, 0);
      return sum;
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "nodejs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(30); // (1+2+3+4+5) * 2 = 30
  });

  it("should execute object operations", async () => {
    const script = `
      const obj = {
        a: 1,
        b: 2,
        c: 3,
      };
      
      const keys = Object.keys(obj);
      const values = Object.values(obj);
      const sum = values.reduce((acc, val) => acc + val, 0);
      
      return {
        keyCount: keys.length,
        sum: sum,
      };
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchInlineSnapshot(`
      {
        "keyCount": 3,
        "sum": 6,
      }
    `);
  });

  it("should handle string operations", async () => {
    const script = `
      const str = "hello world";
      const reversed = str.split('').reverse().join('');
      const uppercase = str.toUpperCase();
      
      return {
        original: str,
        reversed: reversed,
        uppercase: uppercase,
        length: str.length,
      };
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "hermes",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchInlineSnapshot(`
      {
        "length": 11,
        "original": "hello world",
        "reversed": "dlrow olleh",
        "uppercase": "HELLO WORLD",
      }
    `);
  });

  it("should handle nested functions", async () => {
    const script = `
      function outer(x) {
        function inner(y) {
          return x + y;
        }
        return inner;
      }
      
      const addFive = outer(5);
      const result = addFive(3);
      
      return result;
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "nodejs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(8);
  });

  it("should handle recursive functions", async () => {
    const script = `
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      
      return fibonacci(10);
    `;

    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script,
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(55);
  });
});
