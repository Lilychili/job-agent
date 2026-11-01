import { describe, expect, it } from "vitest";
import { answerRule, checkAnswer, DEFAULT_QUESTIONS, MAX_LONG_ANSWER_CHARS, MAX_SHORT_ANSWER_CHARS } from "../src/answers";
import { questionKey } from "../src/normalize";

const ruleFor = (start: string) => {
  const q = DEFAULT_QUESTIONS.find((x) => x.question.startsWith(start))!;
  return answerRule(questionKey(q.question), q.kind);
};

describe("answerRule", () => {
  it("gives the seeded questions the limit they need", () => {
    expect(ruleFor("Why do you want").maxChars).toBe(MAX_LONG_ANSWER_CHARS);
    expect(ruleFor("What is your notice").maxChars).toBe(MAX_SHORT_ANSWER_CHARS);
    expect(ruleFor("Are you open").maxChars).toBe(MAX_SHORT_ANSWER_CHARS);
    expect(ruleFor("How many years").format).toBe("number");
    expect(ruleFor("LinkedIn").format).toBe("link");
    expect(ruleFor("Portfolio").format).toBe("link");
    expect(ruleFor("I consent").format).toBe("yes-no");
  });

  it("lets questions you add have long answers", () => {
    expect(answerRule("describe_a_hard_project", "text").maxChars).toBe(MAX_LONG_ANSWER_CHARS);
  });
});

describe("checkAnswer", () => {
  it("accepts empty, which means not answered yet", () => {
    for (const start of ["Why do you want", "How many years", "LinkedIn", "I consent"]) {
      expect(checkAnswer(ruleFor(start), "   ")).toBeNull();
    }
  });

  it("measures length after trimming and rejects one character over", () => {
    const rule = ruleFor("What is your notice");
    expect(checkAnswer(rule, `  ${"x".repeat(MAX_SHORT_ANSWER_CHARS)}  `)).toBeNull();
    expect(checkAnswer(rule, "x".repeat(MAX_SHORT_ANSWER_CHARS + 1))).toBe("Too long: 201 of 200 characters.");
  });

  it("wants a number for number questions", () => {
    const rule = ruleFor("How many years");
    expect(checkAnswer(rule, "5")).toBeNull();
    expect(checkAnswer(rule, "7.5")).toBeNull();
    expect(checkAnswer(rule, "5 years")).toBe("Enter a number, e.g. 5.");
  });

  it("wants a full http or https link", () => {
    const rule = ruleFor("LinkedIn");
    expect(checkAnswer(rule, "https://www.linkedin.com/in/someone")).toBeNull();
    expect(checkAnswer(rule, "linkedin.com/in/someone")).not.toBeNull();
    expect(checkAnswer(rule, "javascript://example.com/alert(1)")).not.toBeNull();
    expect(checkAnswer(rule, "https://localhost")).not.toBeNull();
  });

  it("takes only Yes or No for consent", () => {
    const rule = ruleFor("I consent");
    expect(checkAnswer(rule, "Yes")).toBeNull();
    expect(checkAnswer(rule, "no")).toBeNull();
    expect(checkAnswer(rule, "maybe")).toBe("Choose Yes or No.");
  });
});
