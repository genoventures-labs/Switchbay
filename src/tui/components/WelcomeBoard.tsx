import React from "react";
import { Box, Text } from "ink";

type WelcomeBoardProps = {
  version: string;
  user: string;
  email: string;
  model: string;
  cwd: string;
  terminalWidth: number;
};

export function WelcomeBoard({ version, user, email, model, cwd, terminalWidth }: WelcomeBoardProps) {
  const isSmall = terminalWidth < 80;
  const brandColor = "#E57373"; // Salmon/Coral
  const grayColor = "#707070"; // Steel Gray
  
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={grayColor}
      paddingX={1}
      paddingY={1}
      marginBottom={1}
      width="100%"
    >
      <Box paddingX={1} marginBottom={1}>
        <Text color={grayColor}>ORI Code v{version}</Text>
      </Box>
      
      <Box flexDirection={isSmall ? "column" : "row"} paddingY={1}>
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center" paddingX={2}>
          <Text color="white" bold>Welcome back {user}!</Text>
          <Box marginTop={1} marginBottom={1} flexDirection="column" alignItems="center">
            <Text color={brandColor}>  ▄▄▄▄▄  </Text>
            <Text color={brandColor}> █ █ █ █ </Text>
            <Text color={brandColor}> █▄▄▄▄▄█ </Text>
            <Text color={brandColor}>  █   █  </Text>
          </Box>
          <Text color={grayColor}>{model} · ORI Pro</Text>
          <Text color={grayColor}>{email}</Text>
          <Text color={grayColor} truncate="middle">{cwd}</Text>
        </Box>
        
        {!isSmall && (
          <Box 
            borderStyle="single" 
            borderLeft={true} 
            borderRight={false} 
            borderTop={false} 
            borderBottom={false} 
            borderColor={grayColor} 
            paddingX={4}
            flexGrow={1}
          >
             <Box flexDirection="column">
               <Text color="white" bold>Tips for getting started:</Text>
               <Box marginLeft={1} marginTop={1}>
                 <Text color={grayColor}>- <Text color="white">/help</Text> - See all available commands</Text>
                 <Text color={grayColor}>- <Text color="white">/edit</Text> - Rapidly edit a file</Text>
                 <Text color={grayColor}>- <Text color="white">@file</Text> - Mention a file for context</Text>
               </Box>
               
               <Box 
                 marginY={2} 
                 borderStyle="single" 
                 borderTop={true} 
                 borderBottom={false} 
                 borderLeft={false} 
                 borderRight={false} 
                 borderColor={grayColor} 
               />
               
               <Text color="white" bold>Recent activity:</Text>
               <Box marginTop={1}>
                 <Text color={grayColor}>No recent activity</Text>
               </Box>
             </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
