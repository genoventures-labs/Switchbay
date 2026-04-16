import React from "react";
import { Box, Text } from "ink";
import type { Bundle } from "../../tools/bundles";

type BundleDrawerProps = {
  bundles: Bundle[];
  activeBundleIds: string[];
  selectedIndex: number;
  visible: boolean;
};

export function BundleDrawer({
  bundles,
  activeBundleIds,
  selectedIndex,
  visible,
}: BundleDrawerProps) {
  if (!visible) {
    return null;
  }

  const brandColor = "#E57373"; // Salmon/Coral
  const greenColor = "#00FF7F"; // Bright Spring Green
  const grayColor = "#707070";  // Steel Gray

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginTop={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={grayColor}
    >
      <Box marginBottom={1}>
        <Text color={brandColor} bold>ORI Bundles</Text>
        <Text color={grayColor}> · Select to toggle specialization</Text>
      </Box>

      {bundles.length > 0 ? (
        bundles.map((bundle, index) => {
          const selected = index === selectedIndex;
          const isActive = activeBundleIds.includes(bundle.manifest.id);

          return (
            <Box
              key={bundle.manifest.id}
              flexDirection="column"
              marginTop={0}
              marginBottom={0}
              paddingX={1}
              paddingY={selected ? 1 : 0}
              backgroundColor={selected ? "#2D333B" : undefined}
            >
              <Box gap={1}>
                <Text color={selected ? greenColor : grayColor} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color={isActive ? greenColor : "white"} bold={selected || isActive}>
                  {bundle.manifest.name}
                </Text>
                <Text color={grayColor}>[v{bundle.manifest.version}]</Text>
                {isActive && <Text color={greenColor} bold>· active</Text>}
              </Box>
              
              {selected && (
                <Box flexDirection="column" marginLeft={2} marginTop={0}>
                  <Text color="white">{bundle.manifest.description}</Text>
                  <Text color={grayColor}>└ {isActive ? "Press Enter to disable" : "Press Enter to enable"}</Text>
                </Box>
              )}
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No bundles found in .ori/bundles/</Text>
      )}
    </Box>
  );
}
