import { type PluginContext } from "@lmstudio/sdk";
import { configSchematics } from "./config/schematics";
import { promptPreprocessor } from "./prompt/preprocessor";
import { toolsProvider } from "./tools/toolsProvider";

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withPromptPreprocessor(promptPreprocessor);
  context.withToolsProvider(toolsProvider);
}
