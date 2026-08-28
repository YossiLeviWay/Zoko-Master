function numericScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tokenize(expression) {
  const compact = String(expression || '').replace(/\s+/gu, '');
  if (!compact || !/^[0-9.+\-*/()%]+$/u.test(compact)) throw new Error('INVALID_FORMULA');
  return compact.match(/\d+(?:\.\d+)?|[()+\-*/%]/gu) || [];
}

function evaluateMathExpression(expression) {
  const tokens = tokenize(expression);
  let index = 0;
  function primary() {
    const token = tokens[index++];
    if (token === '(') {
      const value = addition();
      if (tokens[index++] !== ')') throw new Error('INVALID_FORMULA');
      return value;
    }
    if (token === '+') return primary();
    if (token === '-') return -primary();
    if (!token || !/^\d/u.test(token)) throw new Error('INVALID_FORMULA');
    const value = Number(token);
    if (tokens[index] === '%') { index += 1; return value / 100; }
    return value;
  }
  function multiplication() {
    let value = primary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = primary();
      if (operator === '/' && right === 0) throw new Error('DIVIDE_BY_ZERO');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function addition() {
    let value = multiplication();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = multiplication();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = addition();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('INVALID_FORMULA');
  return result;
}

export function calculateSubjectGrade(subject, scores = {}) {
  const components = Array.isArray(subject?.components) ? subject.components : [];
  const values = components.map(component => numericScore(scores[component.id]));
  if (values.every(value => value === null)) return null;
  if (typeof subject?.formula === 'string' && subject.formula.trim()) {
    const expression = components.reduce((result, _component, index) => (
      result.replace(new RegExp(`\\bC${index + 1}\\b`, 'giu'), String(values[index] ?? 0))
    ), subject.formula.trim());
    if (/[A-Za-z_]/u.test(expression)) throw new Error('UNKNOWN_FORMULA_VARIABLE');
    return Math.round(evaluateMathExpression(expression) * 100) / 100;
  }
  const populated = components.map((component, index) => ({ value: values[index], weight: Number(component.weight) || 0 }))
    .filter(item => item.value !== null && item.weight > 0);
  if (!populated.length) return null;
  const totalWeight = populated.reduce((sum, item) => sum + item.weight, 0);
  return Math.round((populated.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight) * 100) / 100;
}
