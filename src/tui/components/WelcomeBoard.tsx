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
  
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={0}
      marginBottom={1}
      width="100%"
    >
      <Box paddingX={1}>
        <Text color="gray" dimColor>ORI Code v{version}</Text>
      </Box>
      
      <Box 
        borderStyle="single" 
        borderTop={true} 
        borderBottom={false} 
        borderLeft={false} 
        borderRight={false} 
        borderColor="gray" 
      />
      
      <Box flexDirection={isSmall ? "column" : "row"} paddingY={1}>
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center" paddingX={2}>
          <Text color="white" bold>Welcome back {user}!</Text>
          <Box marginTop={1} marginBottom={1} flexDirection="column" alignItems="center">
            <Text color="magenta">  ▄▄▄▄▄  </Text>
            <Text color="magenta"> █ █ █ █ </Text>
            <Text color="magenta"> █▄▄▄▄▄█ </Text>
            <Text color="magenta">  █   █  </Text>
          </Box>
          <Text color="gray" dimColor>{model} · ORI Pro</Text>
          <Text color="gray" dimColor>{email}</Text>
          <Text color="gray" dimColor truncate="middle">{cwd}</Text>
        </Box>
        
        {!isSmall && (
          <Box 
            borderStyle="single" 
            borderLeft={true} 
            borderRight={false} 
            borderTop={false} 
            borderBottom={false} 
            borderColor="gray" 
            paddingX={2}
            flexGrow={1}
          >
             <Box flexDirection="column">
               <Text color="white" bold>Tips for getting started:</Text>
               <Box marginLeft={1}>
                 <Text color="gray" dimColor>- /help - See all available commands</Text>
                 <Text color="gray" dimColor>- /edit - Rapidly edit a file</Text>
                 <Text color="gray" dimColor>- @file - Mention a file for context</Text>
               </Box>
               
               <Box 
                 marginY={1} 
                 borderStyle="single" 
                 borderTop={true} 
                 borderBottom={false} 
                 borderLeft={false} 
                 borderRight={false} 
                 borderColor="gray" 
               />
               
               <Text color="white" bold>Recent activity:</Text>
               <Text color="gray" dimColor>No recent activity</Text>
             </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
