import { test as base } from "@playwright/test";
import {
  ChartsPage,
  ChatPage,
  HeaderPage,
  PositionsPage,
  TradeBarPage,
  WatchlistPage,
} from "../pages";

type AppFixtures = {
  header: HeaderPage;
  watchlist: WatchlistPage;
  tradeBar: TradeBarPage;
  positions: PositionsPage;
  chat: ChatPage;
  charts: ChartsPage;
};

export const test = base.extend<AppFixtures>({
  header: async ({ page }, use) => {
    await use(new HeaderPage(page));
  },
  watchlist: async ({ page }, use) => {
    await use(new WatchlistPage(page));
  },
  tradeBar: async ({ page }, use) => {
    await use(new TradeBarPage(page));
  },
  positions: async ({ page }, use) => {
    await use(new PositionsPage(page));
  },
  chat: async ({ page }, use) => {
    await use(new ChatPage(page));
  },
  charts: async ({ page }, use) => {
    await use(new ChartsPage(page));
  },
});

export { expect } from "@playwright/test";
