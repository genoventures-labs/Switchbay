import React from "react";
import { Box, Newline, Text } from "ink";
import TextInput from "ink-text-input";

type ComposerProps = {
  disabled?: boolean;
  initialQuery: string;
  query: string;
  setQuery: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
};

export function Composer({
  disabled = false,
  initialQuery,
  onSubmit,
  query,
  setQuery,
}: ComposerProps) {
  return (
    <>
      <Box
        flexDirection="column"
        paddingX={1}
        marginTop={1}
      >
        {!initialQuery && !disabled && (
          <Box>
            <Text color="cyan" bold>
              /
            </Text>
            <Text> </Text>
            <TextInput value={query} onChange={setQuery} onSubmit={onSubmit} />
          </Box>
        )}

        <Text color="gray" dimColor>
          {initialQuery
            ? "One-shot mode. Ctrl+C to exit."
            : disabled
              ? "Edit intent mode. Press Enter to draft the change or Esc to cancel."
              : "Enter to send. / for commands. Tab inserts. Ctrl+U / Ctrl+D scroll transcript."}
        </Text>
        <Newline />
      </Box>
    </>
  );
}
