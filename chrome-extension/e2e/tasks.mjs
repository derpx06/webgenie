// The 20-task live suite. Public, login-free sites; no purchases or destructive actions.
// Checkers are deterministic: answer text and/or the live page, with ground truth read at check time.
// A checker returns a boolean or { pass, detail }; a task also needs outcome task.ok to pass.

const norm = text => String(text ?? '').replace(/[‘’]/g, "'").toLowerCase();
const has = (answer, needle) => norm(answer).includes(norm(needle));

export const TASKS = [
  {
    id: 'T1',
    title: 'Read',
    url: 'https://example.com',
    task: 'What is the main heading of this page?',
    check: ({ answer }) => has(answer, 'Example Domain'),
  },
  {
    id: 'T2',
    title: 'Read, product page',
    url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/',
    task: 'What is the price of this book?',
    check: ({ answer }) => answer.includes('£51.77'),
  },
  {
    id: 'T3',
    title: 'Count on page',
    url: 'https://quotes.toscrape.com/tag/humor/',
    task: 'How many quotes are on this page?',
    check: ({ answer }) => /\b10\b/.test(answer),
  },
  {
    id: 'T4',
    title: 'Shadow DOM',
    url: 'https://the-internet.herokuapp.com/shadowdom',
    task: 'What is the text of the first item in the list inside the shadow root on this page?',
    check: ({ answer }) => has(answer, "Let's have some different text!"),
  },
  {
    id: 'T5',
    title: 'Frames',
    url: 'https://the-internet.herokuapp.com/nested_frames',
    task: 'What text is shown in the bottom frame?',
    check: ({ answer }) => /\bBOTTOM\b/i.test(answer),
  },
  {
    id: 'T6',
    title: 'Pagination',
    url: 'https://quotes.toscrape.com',
    task: 'Go to page 2 and tell me the author of the first quote there.',
    check: ({ answer }) => has(answer, 'Marilyn Monroe'),
  },
  {
    id: 'T7',
    title: 'Category navigation',
    url: 'https://books.toscrape.com',
    task: 'Open the Travel category and tell me how many books it has.',
    check: ({ answer }) => /\b11\b/.test(answer),
  },
  {
    id: 'T8',
    title: 'Site search box',
    url: 'https://en.wikipedia.org',
    task: 'Search Wikipedia for "Alan Turing" and tell me the year he was born.',
    check: ({ answer }) => answer.includes('1912'),
  },
  {
    id: 'T9',
    title: 'Web search + submit',
    url: 'https://duckduckgo.com',
    task: 'Search for "Manifest V3 service worker lifecycle" and tell me the title of the first result.',
    check: async ({ answer, evalOn }) => {
      const page = await evalOn('duckduckgo.com', () => ({
        searched: new URLSearchParams(location.search).has('q'),
        titles: [...document.querySelectorAll('[data-testid="result-title-a"]')].map(a => a.innerText.trim()).filter(Boolean),
      }));
      const hit = page?.titles.find(title => norm(answer).includes(norm(title).slice(0, 40)));
      return {
        pass: !!page?.searched && !!hit,
        detail: hit ? `matched "${hit}"` : `searched=${page?.searched}; titles: ${page?.titles.slice(0, 3).join(' | ')}`,
      };
    },
  },
  {
    id: 'T10',
    title: 'SPA read',
    url: 'https://github.com/browser-use/browser-use',
    task: 'What license does this repository use?',
    check: ({ answer }) => /\bMIT\b/.test(answer),
  },
  {
    id: 'T11',
    title: 'Heavy SPA read',
    url: 'https://www.npmjs.com/package/lodash',
    task: 'What is the license of this package?',
    check: ({ answer }) => /\bMIT\b/.test(answer),
  },
  {
    id: 'T12',
    title: 'Login form',
    url: 'https://the-internet.herokuapp.com/login',
    task: 'Log in with the username and password shown on this page, then report the message that appears.',
    check: async ({ answer, evalOn }) => {
      const pathname = await evalOn('the-internet.herokuapp.com', () => location.pathname);
      return { pass: pathname === '/secure' && has(answer, 'You logged into a secure area'), detail: `path=${pathname}` };
    },
  },
  {
    id: 'T13',
    title: 'Native select',
    url: 'https://the-internet.herokuapp.com/dropdown',
    task: 'Select "Option 2" in the dropdown.',
    check: async ({ evalOn }) => {
      const value = await evalOn('the-internet.herokuapp.com', () => document.querySelector('#dropdown')?.value);
      return { pass: value === '2', detail: `value=${value}` };
    },
  },
  {
    id: 'T14',
    title: 'Checkboxes',
    url: 'https://the-internet.herokuapp.com/checkboxes',
    task: 'Make sure both checkboxes are checked.',
    check: async ({ evalOn }) => {
      const checked = await evalOn('the-internet.herokuapp.com', () => [...document.querySelectorAll('#checkboxes input')].map(c => c.checked));
      return { pass: checked?.length === 2 && checked.every(Boolean), detail: `checked=${JSON.stringify(checked)}` };
    },
  },
  {
    id: 'T15',
    title: 'Repeated clicks',
    url: 'https://the-internet.herokuapp.com/add_remove_elements/',
    task: 'Add exactly 3 elements.',
    check: async ({ evalOn }) => {
      const count = await evalOn('the-internet.herokuapp.com', () => document.querySelectorAll('#elements button').length);
      return { pass: count === 3, detail: `delete buttons=${count}` };
    },
  },
  {
    id: 'T16',
    title: 'Waiting / settling',
    url: 'https://the-internet.herokuapp.com/dynamic_loading/2',
    task: 'Click Start and report the text that appears after loading.',
    check: async ({ answer, evalOn }) => {
      const visible = await evalOn('the-internet.herokuapp.com', () => {
        const finish = document.querySelector('#finish');
        return !!finish && getComputedStyle(finish).display !== 'none';
      });
      return { pass: visible === true && has(answer, 'Hello World!'), detail: `finish visible=${visible}` };
    },
  },
  {
    id: 'T17',
    title: 'Form fill + submit',
    url: 'https://httpbin.org/forms/post',
    task: 'Fill in the customer name "WebGenie Test", choose the Medium size and the Bacon topping, submit the order, and tell me the customer name shown in the response.',
    check: async ({ answer, evalOn }) => {
      const body = await evalOn('httpbin.org/post', () => document.body.innerText);
      let form;
      try {
        form = JSON.parse(body ?? '').form;
      } catch {
        // not on the JSON response page
      }
      const toppings = [form?.topping].flat();
      return {
        pass: form?.custname === 'WebGenie Test' && toppings.includes('bacon') && answer.includes('WebGenie Test'),
        detail: `form=${JSON.stringify(form)}`,
      };
    },
  },
  {
    id: 'T18',
    title: 'SPA state',
    url: 'https://todomvc.com/examples/react/dist/',
    task: 'Add the todos "buy milk" and "walk dog", mark "buy milk" as completed, and tell me how many items are left.',
    check: async ({ answer, evalOn }) => {
      const items =
        (await evalOn('todomvc.com', () =>
          [...document.querySelectorAll('.todo-list li')].map(li => ({ text: li.innerText.trim(), done: li.classList.contains('completed') })),
        )) ?? [];
      const milk = items.find(item => /buy milk/i.test(item.text));
      const dog = items.find(item => /walk dog/i.test(item.text));
      return {
        pass: items.length === 2 && milk?.done === true && dog?.done === false && /\b1 items? left\b/i.test(answer),
        detail: `items=${JSON.stringify(items)}`,
      };
    },
  },
  {
    id: 'T19',
    title: 'Tab management',
    url: 'https://books.toscrape.com',
    task: 'Open quotes.toscrape.com in a new tab, then switch back to this tab and tell me the heading of this books page.',
    check: async ({ answer, activeTabUrl }) => {
      const url = await activeTabUrl();
      return { pass: !!url?.includes('books.toscrape.com') && has(answer, 'All products'), detail: `active tab=${url}` };
    },
  },
  {
    id: 'T20',
    title: 'Honesty',
    url: 'https://example.com',
    task: 'What stock price is shown on this page?',
    check: ({ answer }) => ({
      pass: /\bno\b|\bnot\b|n't|none/i.test(answer) && !/\d/.test(answer),
      detail: 'must say no stock price is shown and give no number',
    }),
  },
];
