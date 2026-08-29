const normalize = value => String(value || '')
  .normalize('NFKC')
  .replace(/[\u0591-\u05C7]/gu, '')
  .replace(/[״”]/gu, '"')
  .replace(/[׳’]/gu, "'")
  .replace(/[^\p{L}\p{N}\s'"-]/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLocaleLowerCase('he-IL');

const CLASS_QUESTION = /(?:באיזו|באיזה|איזו|איזה)\s+כיתה|איפה\s+(?:לומד|לומדת)|(?:לומד|לומדת)\s+בכיתה/u;
const CAPABILITY_QUESTION = /(?:מה|איך)\s+(?:אתה|את)\s+(?:יכול|יכולה)|במה\s+(?:אתה|את)\s+(?:יכול|יכולה)\s+לעזור|מה\s+אפשר\s+(?:לעשות|לשאול)/u;
const TASK_HELP_QUESTION = /איך\s+(?:יוצרים|יוצר|יוצרת|ליצור|פותחים|לפתוח)\s+משימה/u;

function studentName(student) {
  return String(student?.fullName || student?.name || `${student?.firstName || ''} ${student?.lastName || ''}`).replace(/\s+/gu, ' ').trim();
}

function matchingStudents(question, students) {
  const normalizedQuestion = normalize(question);
  return students
    .map(student => ({ student, name: studentName(student), normalizedName: normalize(studentName(student)) }))
    .filter(item => item.normalizedName.length >= 2 && normalizedQuestion.includes(item.normalizedName))
    .sort((left, right) => right.normalizedName.length - left.normalizedName.length);
}

export function answerZokiOnSpark({ question, students = [] } = {}) {
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) return null;

  if (CAPABILITY_QUESTION.test(normalizedQuestion)) {
    return {
      answer: 'אני יכול לעזור להתמצא באפליקציה, למצוא מידע שמותר לך לראות ולסייע ביצירת משימות. כרגע, במצב החינמי, שאלות על תלמידים נענות ישירות מהמידע המורשה במערכת ופעולות רגישות עדיין דורשות מסך אישור.',
      sources: [],
    };
  }

  if (TASK_HELP_QUESTION.test(normalizedQuestion)) {
    return {
      answer: 'אפשר פשוט לכתוב לי איזו משימה ליצור, למי היא מיועדת ומה תאריך היעד. אכין הצעה מסודרת ואבקש ממך אישור לפני השמירה.',
      sources: [],
    };
  }

  if (CLASS_QUESTION.test(normalizedQuestion)) {
    const matches = matchingStudents(question, students);
    if (matches.length === 1) {
      const { student, name } = matches[0];
      const className = String(student.className || '').trim();
      return {
        answer: className
          ? `${name} לומד/ת בכיתה ${className}.`
          : `מצאתי את ${name}, אבל לא רשום כרגע שיוך לכיתה.`,
        sources: [{ id: `student_${student.id}`, label: name, route: '/students' }],
      };
    }
    if (matches.length > 1) {
      const options = matches.slice(0, 4).map(({ student, name }) => `${name}${student.className ? ` — ${student.className}` : ''}`);
      return {
        answer: `מצאתי כמה תלמידים מתאימים:\n${options.join('\n')}\nאפשר לכתוב את השם המלא כדי שאענה במדויק.`,
        sources: [],
      };
    }
    return {
      answer: 'לא מצאתי תלמיד מתאים בתוך המידע שיש לך הרשאה לראות. כדאי לבדוק את האיות ולכתוב שם מלא.',
      sources: [],
    };
  }

  return null;
}
