// 2026-10-11 15:27 KST: CodexCode - validate text completely before planning USB key presses.
"use strict";
(() => {
  const plain = {
    " ": "Space", "\t": "Tab", "\n": "Enter", "-": "Minus", "=": "Equal",
    "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", ";": "Semicolon",
    "'": "Quote", "`": "Backquote", ",": "Comma", ".": "Period", "/": "Slash"
  };
  const shifted = {"_": "Minus", "+": "Equal", "{": "BracketLeft", "}": "BracketRight",
    "|": "Backslash", ":": "Semicolon", '"': "Quote", "~": "Backquote", "<": "Comma",
    ">": "Period", "?": "Slash"};
  [..."!@#$%^&*()"].forEach((letter, index) => { shifted[letter] = `Digit${(index + 1) % 10}`; });
  const initials = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];
  const vowels = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];
  const finals = ["", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"];
  const jamo = {};
  [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"].forEach((letter, index) => { jamo[letter] = initials[index]; });
  [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ"].forEach((letter, index) => { jamo[letter] = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "y", "n", "b", "m", "l"][index]; });
  const imeKeys = new Set(["AltRight", "ControlLeft,Space", "ShiftLeft,Space", "MetaLeft,Space"]);
  function ascii(letter) {
    if (/^[a-z]$/.test(letter)) return [`Key${letter.toUpperCase()}`];
    if (/^[A-Z]$/.test(letter)) return ["ShiftLeft", `Key${letter}`];
    if (/^[0-9]$/.test(letter)) return [`Digit${letter}`];
    if (plain[letter]) return [plain[letter]];
    if (shifted[letter]) return ["ShiftLeft", shifted[letter]];
    return null;
  }
  function plan(text, layout = "us", imeKey = "AltRight") {
    if (typeof text !== "string" || !text.length) throw new Error("입력할 텍스트를 적거나 붙여 넣으세요.");
    if (!["us", "ko"].includes(layout)) throw new Error("입력 방식을 확인하세요.");
    if (layout === "ko" && !imeKeys.has(imeKey)) throw new Error("대상 기기의 한/영 전환키를 선택하세요.");
    const letters = [...text.replace(/\r\n?/g, "\n")];
    if (letters.length > 2000) throw new Error("한 번에 입력할 수 있는 텍스트는 2,000자까지입니다.");
    const steps = [];
    let korean = false;
    function switchMode(next) {
      if (next === korean) return;
      steps.push({codes: imeKey.split(","), ime: next, delay: 150});
      korean = next;
    }
    letters.forEach((letter, index) => {
      const code = letter.codePointAt(0), keys = ascii(letter);
      if (keys) {
        switchMode(false); steps.push({codes: keys});
      } else if (layout === "ko" && code >= 0xac00 && code <= 0xd7a3) {
        switchMode(true);
        const offset = code - 0xac00;
        const strokes = initials[Math.floor(offset / 588)] + vowels[Math.floor(offset % 588 / 28)] + finals[offset % 28];
        [...strokes].forEach(key => steps.push({codes: ascii(key)}));
      } else if (layout === "ko" && jamo[letter]) {
        // Commit neighbouring syllables and standalone jamo without composing them together.
        switchMode(false); switchMode(true);
        steps.push({codes: ascii(jamo[letter])});
        switchMode(false);
      } else {
        throw new Error(`${index + 1}번째 문자 ‘${letter}’는 이 입력 방식에서 지원하지 않습니다. 한글은 ‘한글 두벌식 + 영문’을 선택하세요. 이모지 등은 지원하지 않습니다.`);
      }
      steps[steps.length - 1].progress = index + 1;
    });
    switchMode(false);
    return {steps, total: letters.length};
  }
  globalThis.KVMText = Object.freeze({plan});
})();
