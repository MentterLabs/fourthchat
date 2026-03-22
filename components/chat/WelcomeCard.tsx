/** @jsxImportSource chat */
import { Card, Section, Button, Actions, CardText } from "chat";

interface WelcomeCardProps {
  userName: string;
  chatbotName: string;
}

export const WelcomeCard = ({ userName, chatbotName }: WelcomeCardProps) => (
  <Card
    title={`Welcome to ${chatbotName}!`}
    subtitle={`Hi ${userName}!`}
  >
    <Section>
      <CardText>
        I&apos;m here to help you get the most out of FourthChat. Feel free to ask me anything about this business!
      </CardText>
    </Section>
    <Actions>
      <Button label="Help" id="help" />
      <Button label="Settings" id="settings" />
    </Actions>
  </Card>
);
