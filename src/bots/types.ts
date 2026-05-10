import type { BotContext, LegalAction } from "../sim/actions";

export type MahjongBot = {
  name: string;
  chooseAction(context: BotContext): LegalAction;
};

