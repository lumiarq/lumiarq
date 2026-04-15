export interface WelcomePageProps {
  version: string
  environment: "local" | "testing" | "staging" | "production"
  appName: string
}
