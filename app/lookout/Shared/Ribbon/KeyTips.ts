export function assignKeyTips(labels: string[], reserved: string[] = [], preferSingle = false): string[] {
  let tips: string[] = labels.map(() => null);
  let used = new Set(reserved.map(tip => tip.toUpperCase()));
  let letters = labels.map(label => keyTipLetters(label));
  let firstCounts = new Map<string, number>();
  for (let chars of letters) {
    if (chars.length) {
      firstCounts.set(chars[0], (firstCounts.get(chars[0]) ?? 0) + 1);
    }
  }
  letters.forEach((chars, i) => {
    let first = chars[0];
    if (first && firstCounts.get(first) == 1 && !used.has(first)) {
      tips[i] = first;
      used.add(first);
    }
  });
  if (preferSingle) {
    letters.forEach((chars, i) => {
      if (tips[i]) {
        return;
      }
      let single = chars.find(char => !used.has(char) && !isPrefixOfUsed(char, used));
      if (single) {
        tips[i] = single;
        used.add(single);
      }
    });
  }
  letters.forEach((chars, i) => {
    if (tips[i]) {
      return;
    }
    let tip = twoLetterCandidates(labels[i], chars)
      .find(candidate => !used.has(candidate) && !used.has(candidate[0]));
    tips[i] = tip ?? fallbackKeyTip(used);
    used.add(tips[i]);
  });
  return tips;
}

export function keyTipLetters(label: string): string[] {
  return Array.from((label ?? "").normalize("NFD").toUpperCase())
    .filter(char => /[A-Z]/.test(char));
}

export function keyTipWords(label: string): string[][] {
  return (label ?? "").split(/[\s/&+\-–_.,:()]+/)
    .map(word => keyTipLetters(word))
    .filter(chars => chars.length);
}

function twoLetterCandidates(label: string, chars: string[]): string[] {
  let words = keyTipWords(label);
  let firsts = [...new Set(chars)];
  let candidates: string[] = [];
  for (let first of firsts) {
    for (let word of words.slice(1)) {
      candidates.push(first + word[0]);
    }
    for (let char of chars.slice(chars.indexOf(first) + 1)) {
      candidates.push(first + char);
    }
  }
  return [...new Set(candidates)];
}

function isPrefixOfUsed(char: string, used: Set<string>): boolean {
  for (let tip of used) {
    if (tip.length > 1 && tip.startsWith(char)) {
      return true;
    }
  }
  return false;
}

function fallbackKeyTip(used: Set<string>): string {
  const kFirsts = "ZYXWVQJK";
  for (let first of kFirsts) {
    if (used.has(first)) {
      continue;
    }
    for (let second = 1; second <= 9; second++) {
      let tip = first + second;
      if (!used.has(tip)) {
        return tip;
      }
    }
  }
  return "Z" + used.size;
}

export function quickAccessKeyTip(index: number): string {
  if (index < 9) {
    return String(index + 1);
  }
  let beyond = index - 9;
  if (beyond < 9) {
    return "0" + String(9 - beyond);
  }
  return "0" + String.fromCharCode("A".charCodeAt(0) + beyond - 9);
}
