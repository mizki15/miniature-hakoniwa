/** ログインが要る（トークンがない・切れた）。自分からはポップアップを出さず、画面に「再ログイン」を出す合図 */
export class NeedsLoginError extends Error {
  constructor(message = 'Google へのログインが必要です') { super(message); this.name = 'NeedsLoginError'; }
}
