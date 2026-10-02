// Backend translations for notifications
import { type AppLanguage, getRegionForTimezone, normalizeAppLanguage } from "@medassist/shared";
import { parseStringListEnv } from "../utils/env-parsing.js";

export type Language = AppLanguage;

function getRegionFromTimezone(): string | undefined {
	const tz = process.env.TZ;
	if (!tz) return undefined;
	return getRegionForTimezone(tz);
}

type TranslationKeys = {
	// Stock reminder (shared across email + push)
	stockReminder: {
		subject: string;
		title: string;
		description: string;
		descriptionEmpty: string;
		descriptionMixed: string;
		alertSingle: string;
		alertMultiple: string;
		alertEmptySingle: string;
		alertEmptyMultiple: string;
		alertLowSingle: string;
		alertLowMultiple: string;
		alertLowStockSingle: string;
		alertLowStockMultiple: string;
		descriptionLow: string;
		tableHeaders: {
			medication: string;
			pills: string;
			days: string;
			runsOut: string;
		};
		now: string;
		repeatDailyNote: string;
	};
	// Intake reminder email
	intakeReminder: {
		subject: string;
		title: string;
		description: string;
		alertSingle: string;
		alertMultiple: string;
		tableHeaders: {
			medication: string;
			dosage: string;
			time: string;
		};
		pills: string;
		takenBy: string;
		repeatLast: string;
		repeatOne: string;
		repeatMultiple: string;
	};
	// Push notifications
	push: {
		stockTitle: string;
		stockTitleMultiple: string;
		intakeTitle: string;
		intakeTakenConfirmation: string;
		intakeSkippedConfirmation: string;
		pillsLeft: string;
		daysLeft: string;
		pillsAt: string;
		repeatDailyNote: string;
		empty: string;
		low: string;
		critical: string;
		lowStock: string;
		reorderNow: string;
		emptySection: string;
		lowSection: string;
		criticalSection: string;
		lowStockSection: string;
	};
	// Prescription reminder (shared across email + push)
	prescriptionReminder: {
		subjectSingle: string;
		subjectMultiple: string;
		pushTitleLow: string;
		pushTitleEmpty: string;
		pushEmpty: string;
		pushEmptySingle: string;
		pushLow: string;
		pushLowSingle: string;
		pushRenewNow: string;
		pushEmptySection: string;
		pushLowSection: string;
		pushRefillsLeft: string;
		title: string;
		titleEmpty: string;
		descriptionLow: string;
		descriptionEmpty: string;
		alertLowSingle: string;
		alertLowMultiple: string;
		alertEmptySingle: string;
		alertEmptyMultiple: string;
		line: string;
		lineEmpty: string;
		expiresSuffix: string;
		repeatDailyNote: string;
		tableHeaders: {
			medication: string;
			refillsLeft: string;
			reminderThreshold: string;
			prescriptionExpires: string;
		};
	};
	// Demand calculator email
	demandCalculator: {
		subject: string;
		title: string;
		description: string;
		summaryOutOfStock: string;
		summaryAllOk: string;
		tableHeaders: {
			medication: string;
			usage: string;
			needed: string;
			prescriptionRefills: string;
			available: string;
			status: string;
		};
		statusEnough: string;
		statusEmpty: string;
		prescriptionNotApplicable: string;
	};
	// Common
	common: {
		pill: string;
		pills: string;
		puffs: string;
		injections: string;
		units: string;
		ml: string;
		blister: string;
		blisters: string;
		day: string;
		days: string;
		soon: string;
		footer: string;
	};
	actionPage: {
		alreadyProcessedTitle: string;
		alreadyTakenBody: string;
		alreadyTakenJson: string;
		alreadySkippedBody: string;
		alreadySkippedJson: string;
		actionRecordedTitle: string;
		doseTakenBody: string;
		intakeSkippedBody: string;
		confirmDoseTitle: string;
		confirmDoseText: string;
		skipIntakeTitle: string;
		skipIntakeText: string;
		respondTitle: string;
		respondText: string;
	};
};

const translations: Record<Language, TranslationKeys> = {
	"en-US": {
		stockReminder: {
			subject: "MedAssist-ng: ⚠️ {count} Medication{s} Running Critically Low",
			title: "⚠️ MedAssist-ng: Automatic Reorder Reminder",
			description: "The following medications are running critically low and need to be reordered:",
			descriptionEmpty: "The following medications are empty and need to be reordered immediately:",
			descriptionMixed: "The following medications need to be reordered:",
			alertSingle: "⚠️ 1 medication running critically low!",
			alertMultiple: "⚠️ {count} medications running critically low!",
			alertEmptySingle: "🚨 1 medication empty - reorder immediately!",
			alertEmptyMultiple: "🚨 {count} medications empty - reorder immediately!",
			alertLowSingle: "⚠️ 1 medication running critically low",
			alertLowMultiple: "⚠️ {count} medications running critically low",
			alertLowStockSingle: "⚠️ 1 medication running low",
			alertLowStockMultiple: "⚠️ {count} medications running low",
			descriptionLow: "The following medications are running low and should be reordered soon:",
			tableHeaders: {
				medication: "Medication",
				pills: "Available",
				days: "Days",
				runsOut: "Runs Out",
			},
			now: "NOW",
			repeatDailyNote: "You are receiving this daily reminder because 'Repeat Daily' is enabled in settings.",
		},
		intakeReminder: {
			subject: "MedAssist-ng: Medication Reminder - {medications}",
			title: "💊 MedAssist-ng - Intake Reminder",
			description: "Time to take your medication in {minutes} minutes:",
			alertSingle: "💊 1 medication scheduled",
			alertMultiple: "💊 {count} medications scheduled",
			tableHeaders: {
				medication: "Medication",
				dosage: "Dosage",
				time: "Time",
			},
			pills: "pills",
			takenBy: "for {name}",
			repeatLast: "⚠️ This is the last reminder.",
			repeatOne: "ℹ️ One more reminder will be sent in {minutes} minutes.",
			repeatMultiple: "ℹ️ {count} more reminders will be sent every {minutes} minutes.",
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medication Running Critically Low",
			stockTitleMultiple: "MedAssist-ng: {count} Medications Running Critically Low",
			intakeTitle: "💊 Reminder: Medication intake in {minutes} min",
			intakeTakenConfirmation: "✅ This dose was marked as taken.",
			intakeSkippedConfirmation: "⏭️ This intake was marked as skipped.",
			pillsLeft: "{count} pills",
			daysLeft: "{count} days left",
			pillsAt: "{count} pills at {time}",
			repeatDailyNote: "(Daily reminder enabled)",
			empty: "Empty",
			low: "Critical",
			critical: "Critical",
			lowStock: "Low",
			reorderNow: "Reorder Now!",
			emptySection: "Empty (reorder immediately)",
			lowSection: "Running critically low",
			criticalSection: "Running critically low",
			lowStockSection: "Running low",
		},
		prescriptionReminder: {
			subjectSingle: "MedAssist-ng: 🚨 Prescription Refill Reminder",
			subjectMultiple: "MedAssist-ng: 🚨 {count} Prescriptions Need Renewal Soon",
			pushTitleLow: "💊 MedAssist-ng: {count} prescriptions are running low",
			pushTitleEmpty: "💊 MedAssist-ng: {count} prescriptions need renewal now",
			pushEmpty: "prescriptions out of refills",
			pushEmptySingle: "prescription out of refills",
			pushLow: "prescriptions low on refills",
			pushLowSingle: "prescription low on refills",
			pushRenewNow: "Renew Now!",
			pushEmptySection: "Prescriptions with no refills left",
			pushLowSection: "Prescriptions running low on refills",
			pushRefillsLeft: "{count} refill(s) remaining on this prescription",
			title: "⚠️ MedAssist-ng - Prescription Reminder",
			titleEmpty: "🚨 MedAssist-ng - Prescription Reminder",
			descriptionLow: "Some prescriptions are low on remaining refills.",
			descriptionEmpty: "Some prescriptions have no refills left. Contact your doctor for renewal.",
			alertLowSingle: "⚠️ 1 prescription is low on refills",
			alertLowMultiple: "⚠️ {count} prescriptions are low on refills",
			alertEmptySingle: "🚨 1 prescription needs renewal now",
			alertEmptyMultiple: "🚨 {count} prescriptions need renewal now",
			line: "{name}: {refills} refill(s) remaining on this prescription{expirySuffix}",
			lineEmpty: "{name}: no refills remaining on this prescription{expirySuffix}",
			expiresSuffix: ", expires {date}",
			repeatDailyNote: "You are receiving this daily reminder because 'Repeat Daily' is enabled in settings.",
			tableHeaders: {
				medication: "Medication",
				refillsLeft: "Prescription refills left",
				reminderThreshold: "Reminder threshold",
				prescriptionExpires: "Prescription expires",
			},
		},
		demandCalculator: {
			subject: "MedAssist-ng: Supply Overview ({from} - {until})",
			title: "MedAssist-ng: Demand Calculator",
			description: "Supply overview from {from} to {until}",
			summaryOutOfStock: "⚠️ {count} medication{s} will be out of stock during this period.",
			summaryAllOk: "✓ All medications have sufficient supply for this period.",
			tableHeaders: {
				medication: "Medication",
				usage: "Usage",
				needed: "Blisters needed",
				prescriptionRefills: "Prescription refills",
				available: "Available",
				status: "Status",
			},
			statusEnough: "✓ Enough",
			statusEmpty: "✗ Empty",
			prescriptionNotApplicable: "–",
		},
		common: {
			pill: "pill",
			pills: "pills",
			puffs: "puffs",
			injections: "injections",
			units: "units",
			ml: "ml",
			blister: "blister",
			blisters: "blisters",
			day: "day",
			days: "days",
			soon: "soon",
			footer: "🤖 Sent from MedAssist-ng",
		},
		actionPage: {
			alreadyProcessedTitle: "Already processed",
			alreadyTakenBody:
				"This dose is already marked as taken. If you need to change it, open MedAssist and undo it there.",
			alreadyTakenJson: "This dose is already marked as taken. Changes can only be made in MedAssist.",
			alreadySkippedBody:
				"This intake is already marked as skipped. If you want to mark it as taken instead, open MedAssist and do that there.",
			alreadySkippedJson: "This intake is already marked as skipped. Changes can only be made in MedAssist.",
			actionRecordedTitle: "Action recorded",
			doseTakenBody: "The dose was marked as taken.",
			intakeSkippedBody: "The intake was marked as skipped.",
			confirmDoseTitle: "Confirm dose",
			confirmDoseText: "Confirm that this dose should be marked as taken.",
			skipIntakeTitle: "Skip intake",
			skipIntakeText: "Confirm that this intake should be marked as skipped.",
			respondTitle: "Respond to reminder",
			respondText: "Choose an action for this medication reminder.",
		},
	},
	"de-DE": {
		stockReminder: {
			subject: "MedAssist-ng: ⚠️ {count} Medikament{e} kritisch niedrig",
			title: "⚠️ MedAssist-ng: Automatische Nachbestell-Erinnerung",
			description: "Die folgenden Medikamente sind kritisch niedrig und sollten nachbestellt werden:",
			descriptionEmpty: "Die folgenden Medikamente sind leer und müssen sofort nachbestellt werden:",
			descriptionMixed: "Die folgenden Medikamente müssen nachbestellt werden:",
			alertSingle: "⚠️ 1 Medikament kritisch niedrig!",
			alertMultiple: "⚠️ {count} Medikamente kritisch niedrig!",
			alertEmptySingle: "🚨 1 Medikament leer - sofort nachbestellen!",
			alertEmptyMultiple: "🚨 {count} Medikamente leer - sofort nachbestellen!",
			alertLowSingle: "⚠️ 1 Medikament kritisch niedrig",
			alertLowMultiple: "⚠️ {count} Medikamente kritisch niedrig",
			alertLowStockSingle: "⚠️ 1 Medikament niedrig",
			alertLowStockMultiple: "⚠️ {count} Medikamente niedrig",
			descriptionLow: "Die folgenden Medikamente werden knapp und sollten bald nachbestellt werden:",
			tableHeaders: {
				medication: "Medikament",
				pills: "Verfuegbar",
				days: "Tage",
				runsOut: "Aufgebraucht",
			},
			now: "JETZT",
			repeatDailyNote:
				"Sie erhalten diese tägliche Erinnerung, weil 'Täglich wiederholen' in den Einstellungen aktiviert ist.",
		},
		intakeReminder: {
			subject: "MedAssist-ng: Einnahme-Erinnerung - {medications}",
			title: "💊 MedAssist-ng - Einnahme-Erinnerung",
			description: "Zeit für Ihre Medikamente in {minutes} Minuten:",
			alertSingle: "💊 1 Medikament geplant",
			alertMultiple: "💊 {count} Medikamente geplant",
			tableHeaders: {
				medication: "Medikament",
				dosage: "Dosis",
				time: "Uhrzeit",
			},
			pills: "Tabletten",
			takenBy: "für {name}",
			repeatLast: "⚠️ Dies ist die letzte Erinnerung.",
			repeatOne: "ℹ️ Eine weitere Erinnerung wird in {minutes} Minuten gesendet.",
			repeatMultiple: "ℹ️ {count} weitere Erinnerungen werden alle {minutes} Minuten gesendet.",
		},
		push: {
			stockTitle: "MedAssist-ng: 1 Medikament kritisch niedrig",
			stockTitleMultiple: "MedAssist-ng: {count} Medikamente kritisch niedrig",
			intakeTitle: "💊 Erinnerung: Medikamenteneinnahme in {minutes} Min.",
			intakeTakenConfirmation: "✅ Diese Einnahme wurde als genommen markiert.",
			intakeSkippedConfirmation: "⏭️ Diese Einnahme wurde als übersprungen markiert.",
			pillsLeft: "{count} Tabletten",
			daysLeft: "{count} Tage übrig",
			pillsAt: "{count} Tabletten um {time}",
			repeatDailyNote: "(Tägliche Erinnerung aktiviert)",
			empty: "Leer",
			low: "Kritisch",
			critical: "Kritisch",
			lowStock: "Niedrig",
			reorderNow: "Jetzt nachbestellen!",
			emptySection: "Leer (sofort nachbestellen)",
			lowSection: "Kritisch niedrig",
			criticalSection: "Kritisch niedrig",
			lowStockSection: "Niedrig",
		},
		prescriptionReminder: {
			subjectSingle: "MedAssist-ng: 🚨 Rezept-Nachfüll-Erinnerung",
			subjectMultiple: "MedAssist-ng: 🚨 {count} Rezepte müssen bald erneuert werden",
			pushTitleLow: "💊 MedAssist-ng: {count} Rezept(e) haben nur noch wenige Nachfüllungen",
			pushTitleEmpty: "💊 MedAssist-ng: {count} Rezept(e) müssen jetzt erneuert werden",
			pushEmpty: "Rezepte ohne verbleibende Nachfüllung",
			pushEmptySingle: "Rezept ohne verbleibende Nachfüllung",
			pushLow: "Rezepte mit wenigen verbleibenden Nachfüllungen",
			pushLowSingle: "Rezept mit wenigen verbleibenden Nachfüllungen",
			pushRenewNow: "Jetzt erneuern!",
			pushEmptySection: "Rezepte ohne Nachfüllungen",
			pushLowSection: "Rezepte mit bald aufgebrauchten Nachfüllungen",
			pushRefillsLeft: "{count} Nachfüllung(en) für dieses Rezept übrig",
			title: "⚠️ MedAssist-ng - Rezept-Erinnerung",
			titleEmpty: "🚨 MedAssist-ng - Rezept-Erinnerung",
			descriptionLow: "Einige Rezepte haben nur noch wenige Nachfüllungen.",
			descriptionEmpty:
				"Einige Rezepte haben keine Nachfüllungen mehr. Bitte kontaktieren Sie Ihren Arzt für eine Erneuerung.",
			alertLowSingle: "⚠️ 1 Rezept ist bei den Nachfüllungen niedrig",
			alertLowMultiple: "⚠️ {count} Rezepte sind bei den Nachfüllungen niedrig",
			alertEmptySingle: "🚨 1 Rezept muss jetzt erneuert werden",
			alertEmptyMultiple: "🚨 {count} Rezepte müssen jetzt erneuert werden",
			line: "{name}: {refills} Nachfüllung(en) für dieses Rezept übrig{expirySuffix}",
			lineEmpty: "{name}: keine Nachfüllung mehr für dieses Rezept{expirySuffix}",
			expiresSuffix: ", läuft ab {date}",
			repeatDailyNote:
				"Sie erhalten diese tägliche Erinnerung, weil 'Täglich wiederholen' in den Einstellungen aktiviert ist.",
			tableHeaders: {
				medication: "Medikament",
				refillsLeft: "Rezept-Nachfüllungen übrig",
				reminderThreshold: "Erinnerungsschwelle",
				prescriptionExpires: "Rezeptablauf",
			},
		},
		demandCalculator: {
			subject: "MedAssist-ng: Bestandsübersicht ({from} - {until})",
			title: "MedAssist-ng: Bedarfsrechner",
			description: "Bestandsübersicht von {from} bis {until}",
			summaryOutOfStock: "⚠️ {count} Medikament{e} wird im Zeitraum nicht ausreichen.",
			summaryAllOk: "✓ Alle Medikamente reichen für diesen Zeitraum.",
			tableHeaders: {
				medication: "Medikament",
				usage: "Verbrauch",
				needed: "Blister benötigt",
				prescriptionRefills: "Rezept-Nachfüllungen",
				available: "Verfügbar",
				status: "Status",
			},
			statusEnough: "✓ Ausreichend",
			statusEmpty: "✗ Leer",
			prescriptionNotApplicable: "–",
		},
		common: {
			pill: "Tablette",
			pills: "Tabletten",
			puffs: "Hübe",
			injections: "Injektionen",
			units: "Einheiten",
			ml: "ml",
			blister: "Blister",
			blisters: "Blister",
			day: "Tag",
			days: "Tage",
			soon: "bald",
			footer: "🤖 Gesendet von MedAssist-ng",
		},
		actionPage: {
			alreadyProcessedTitle: "Bereits verarbeitet",
			alreadyTakenBody:
				"Diese Einnahme ist bereits als genommen markiert. Wenn Sie das ändern möchten, öffnen Sie MedAssist und machen Sie die Einnahme dort rückgängig.",
			alreadyTakenJson: "Diese Einnahme ist bereits als genommen markiert. Änderungen sind nur in MedAssist möglich.",
			alreadySkippedBody:
				"Diese Einnahme ist bereits als übersprungen markiert. Wenn Sie sie stattdessen als genommen markieren möchten, öffnen Sie MedAssist und machen Sie das dort.",
			alreadySkippedJson:
				"Diese Einnahme ist bereits als übersprungen markiert. Änderungen sind nur in MedAssist möglich.",
			actionRecordedTitle: "Aktion gespeichert",
			doseTakenBody: "Die Einnahme wurde als genommen markiert.",
			intakeSkippedBody: "Die Einnahme wurde als übersprungen markiert.",
			confirmDoseTitle: "Einnahme bestätigen",
			confirmDoseText: "Bestätigen Sie, dass diese Einnahme als genommen markiert werden soll.",
			skipIntakeTitle: "Einnahme überspringen",
			skipIntakeText: "Bestätigen Sie, dass diese Einnahme als übersprungen markiert werden soll.",
			respondTitle: "Erinnerung beantworten",
			respondText: "Wählen Sie eine Aktion für diese Medikamentenerinnerung.",
		},
	},
	"pt-PT": {
		stockReminder: {
			subject: "MedAssist-ng: ⚠️ {count} medicamento{s} a acabar",
			title: "⚠️ MedAssist-ng: Aviso Automático de Encomenda",
			description: "Os seguintes medicamentos estão a acabar e é necessário encomendar mais:",
			descriptionEmpty: "Os seguintes medicamentos acabaram e é necessário encomendar mais de imediato:",
			descriptionMixed: "É necessário encomendar os seguintes medicamentos:",
			alertSingle: "⚠️ 1 medicamento a acabar!",
			alertMultiple: "⚠️ {count} medicamentos a acabar!",
			alertEmptySingle: "🚨 1 medicamento acabou - encomende imediatamente!",
			alertEmptyMultiple: "🚨 {count} medicamentos acabaram - encomende imediatamente!",
			alertLowSingle: "⚠️ 1 medicamento a acabar",
			alertLowMultiple: "⚠️ {count} medicamentos a acabar",
			alertLowStockSingle: "⚠️ 1 medicamento com pouca quantidade",
			alertLowStockMultiple: "⚠️ {count} medicamentos com pouca quantidade",
			descriptionLow: "Os seguintes medicamentos estão a acabar e é necessário encomendar mais:",
			tableHeaders: {
				medication: "Medicamento",
				pills: "Disponível",
				days: "Dias",
				runsOut: "Acaba",
			},
			now: "AGORA",
			repeatDailyNote: "Está a receber este aviso diário porque 'Repetir Diariamente' está activo nas definições.",
		},
		intakeReminder: {
			subject: "MedAssist-ng: Aviso de medicamento - {medications}",
			title: "💊 MedAssist-ng - Aviso de toma",
			description: "Daqui a {minutes} minutos é altura de tomar o medicamento:",
			alertSingle: "💊 1 medicamento agendado",
			alertMultiple: "💊 {count} medicamentos agendados",
			tableHeaders: {
				medication: "Medicamento",
				dosage: "Dosagem",
				time: "Hora",
			},
			pills: "comprimidos",
			takenBy: "para {name}",
			repeatLast: "⚠️ Este é o último aviso.",
			repeatOne: "ℹ️ Será enviado mais um aviso dentro de {minutes} minutos.",
			repeatMultiple: "ℹ️ Serão enviados mais {count} avisos, de {minutes} em {minutes} minutos.",
		},
		push: {
			stockTitle: "MedAssist-ng: 1 medicamento a acabar",
			stockTitleMultiple: "MedAssist-ng: {count} Medicamentos a Acabar",
			intakeTitle: "💊 Aviso: Toma de medicamento em {minutes} min",
			intakeTakenConfirmation: "✅ Esta toma foi assinalada como tomada.",
			intakeSkippedConfirmation: "⏭️ Esta toma foi assinalada como ignorada.",
			pillsLeft: "{count} comprimidos",
			daysLeft: "{count} dias restantes",
			pillsAt: "{count} comprimidos às {time}",
			repeatDailyNote: "(Aviso diário ativado)",
			empty: "Esgotado",
			low: "Crítico",
			critical: "Crítico",
			lowStock: "Baixo",
			reorderNow: "Repor agora!",
			emptySection: "Esgotado (repor imediatamente)",
			lowSection: "Existências muito baixas",
			criticalSection: "Existências em estado crítico",
			lowStockSection: "Poucas existências",
		},
		prescriptionReminder: {
			subjectSingle: "MedAssist-ng: 🚨 Aviso de renovação da receita",
			subjectMultiple: "MedAssist-ng: 🚨 {count} receitas precisam de ser renovadas em breve",
			pushTitleLow: "💊 MedAssist-ng: restam poucas renovações em {count} receitas",
			pushTitleEmpty: "💊 MedAssist-ng: {count} receitas precisam de ser renovadas agora",
			pushEmpty: "receitas sem renovações",
			pushEmptySingle: "receita sem renovações",
			pushLow: "receitas com poucas renovações",
			pushLowSingle: "receita com poucas renovações",
			pushRenewNow: "Renovar agora!",
			pushEmptySection: "Receitas sem renovações restantes",
			pushLowSection: "Receitas quase sem renovações",
			pushRefillsLeft: "restam {count} renovação(ões) nesta receita",
			title: "⚠️ MedAssist-ng - Aviso de receita",
			titleEmpty: "🚨 MedAssist-ng - Aviso de receita",
			descriptionLow: "Algumas receitas têm poucas renovações restantes.",
			descriptionEmpty: "Algumas receitas já não têm renovações. Contacte o seu médico para as renovar.",
			alertLowSingle: "⚠️ Resta uma renovação nesta receita",
			alertLowMultiple: "⚠️ Restam poucas renovações em {count} receitas",
			alertEmptySingle: "🚨 Esta receita precisa de ser renovada agora",
			alertEmptyMultiple: "🚨 {count} receitas precisam de ser renovadas agora",
			line: "{name}: restam {refills} renovação(ões) nesta receita{expirySuffix}",
			lineEmpty: "{name}: não restam renovações nesta receita{expirySuffix}",
			expiresSuffix: ", válida até {date}",
			repeatDailyNote: "Recebe este aviso diário porque a opção «Repetir diariamente» está ativada nas definições.",
			tableHeaders: {
				medication: "Medicamento",
				refillsLeft: "Renovações restantes da receita",
				reminderThreshold: "Limiar do aviso",
				prescriptionExpires: "Validade da receita",
			},
		},
		demandCalculator: {
			subject: "MedAssist-ng: Resumo das existências ({from} - {until})",
			title: "MedAssist-ng: Calculadora de necessidades",
			description: "Resumo das existências de {from} a {until}",
			summaryOutOfStock: "⚠️ {count} medicamento{s} ficarão sem existências durante este período.",
			summaryAllOk: "✓ Há existências suficientes de todos os medicamentos para este período.",
			tableHeaders: {
				medication: "Medicação",
				usage: "Utilização",
				needed: "Lamelas necessárias",
				prescriptionRefills: "Renovações da receita",
				available: "Disponível",
				status: "Estado",
			},
			statusEnough: "✓ Suficiente",
			statusEmpty: "✗ Vazio",
			prescriptionNotApplicable: "–",
		},
		common: {
			pill: "comprimido",
			pills: "comprimidos",
			puffs: "inalações",
			injections: "injecções",
			units: "unidades",
			ml: "ml",
			blister: "lamela",
			blisters: "lamelas",
			day: "dia",
			days: "dias",
			soon: "em breve",
			footer: "🤖 Enviado de MedAssist-ng",
		},
		actionPage: {
			alreadyProcessedTitle: "Já processado",
			alreadyTakenBody: "Esta toma já está assinalada como tomada. Para a alterar, abra o MedAssist e anule a toma.",
			alreadyTakenJson: "Esta toma já está assinalada como tomada. Só pode fazer alterações no MedAssist.",
			alreadySkippedBody:
				"Esta toma já está assinalada como ignorada. Para a assinalar como tomada, abra o MedAssist e altere-a.",
			alreadySkippedJson: "Esta toma já está assinalada como ignorada. Só pode fazer alterações no MedAssist.",
			actionRecordedTitle: "Ação registada",
			doseTakenBody: "A toma foi assinalada como tomada.",
			intakeSkippedBody: "A toma foi assinalada como ignorada.",
			confirmDoseTitle: "Confirmar toma",
			confirmDoseText: "Confirme que pretende assinalar esta toma como tomada.",
			skipIntakeTitle: "Ignorar toma",
			skipIntakeText: "Confirme que pretende assinalar esta toma como ignorada.",
			respondTitle: "Responder ao aviso",
			respondText: "Escolha uma ação para este aviso de medicação.",
		},
	},
};

export function getTranslations(language: Language): TranslationKeys {
	return translations[normalizeAppLanguage(language)];
}

// Helper function to replace placeholders in strings
export function t(template: string, params: Record<string, string | number> = {}): string {
	let result = template;
	for (const [key, value] of Object.entries(params)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
	}
	return result;
}

/**
 * Get locale for formatting based on language and timezone region.
 * Combines the language with the timezone region where possible.
 * Use the language subtag so app IDs do not produce tags such as pt-PT-DE.
 */
export function getDateLocale(language: Language): string {
	const region = getRegionFromTimezone();

	if (region) {
		const localeLanguage = language.split("-")[0];
		return `${localeLanguage}-${region}`;
	}

	// Fallback: use language default
	switch (language) {
		case "de-DE":
			return "de-DE";
		case "pt-PT":
			return "pt-PT";
		default:
			return "en-US";
	}
}

/**
 * Get the app URL from the first CORS_ORIGINS entry.
 * Falls back to empty string if not set.
 */
function getAppUrl(): string {
	return parseStringListEnv(process.env.CORS_ORIGINS)[0] ?? "";
}

/**
 * Get the unified footer as HTML with MedAssist-ng as a link to the instance.
 * @param variant - 'planner' uses the Medication Planner footer text
 */
export function getFooterHtml(language: Language): string {
	const tr = getTranslations(language);
	const appUrl = getAppUrl();
	const appName = appUrl
		? `<a href="${appUrl}" style="color: #6b7280; text-decoration: underline;">MedAssist-ng</a>`
		: "MedAssist-ng";
	return tr.common.footer.replace("MedAssist-ng", appName);
}

/**
 * Get the unified footer as plain text.
 * @param variant - 'planner' uses the Medication Planner footer text
 */
export function getFooterPlain(language: Language): string {
	const tr = getTranslations(language);
	const appUrl = getAppUrl();
	if (appUrl) {
		return `${tr.common.footer} (${appUrl})`;
	}
	return tr.common.footer;
}
