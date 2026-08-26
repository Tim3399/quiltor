import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs";

export function ThreeTabs() {
  const [value, setValue] = useState("card");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabList label="Figurbereiche">
        <Tab value="card">Karte</Tab>
        <Tab value="profile">Profil</Tab>
        <Tab value="links">Beziehungen</Tab>
      </TabList>
      <TabPanel value="card">Karteninhalt</TabPanel>
      <TabPanel value="profile">Profilinhalt</TabPanel>
      <TabPanel value="links">Beziehungsinhalt</TabPanel>
    </Tabs>
  );
}

export function LongLabelsAndDisabled() {
  const [value, setValue] = useState("one");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabList label="Bereiche">
        <Tab value="one">Ein ungewöhnlich langer Bereichsname</Tab>
        <Tab value="two">Weitere Informationen</Tab>
        <Tab value="three" disabled>
          Gesperrt
        </Tab>
      </TabList>
      <TabPanel value="one">Erster Inhalt</TabPanel>
      <TabPanel value="two">Zweiter Inhalt</TabPanel>
      <TabPanel value="three">Dritter Inhalt</TabPanel>
    </Tabs>
  );
}
