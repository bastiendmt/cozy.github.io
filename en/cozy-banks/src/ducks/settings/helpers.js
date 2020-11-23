import maxBy from 'lodash/maxBy'
import flatMap from 'lodash/flatMap'
import groupBy from 'lodash/groupBy'
import get from 'lodash/get'
import merge from 'lodash/merge'
import { DOCTYPE, DEFAULTS_SETTINGS } from 'ducks/settings/constants'
import logger from 'cozy-logger'
import { ACCOUNT_DOCTYPE, GROUP_DOCTYPE } from 'doctypes'

import { connect } from 'react-redux'
import { getDocumentFromState } from 'cozy-client/dist/store'
import { getAccountLabel } from 'ducks/account/helpers'
import { getGroupLabel, getGroupAccountIds } from 'ducks/groups/helpers'
import { translate } from 'cozy-ui/transpiled/react/I18n'
import compose from 'lodash/flowRight'
import {
  getRuleValue,
  getRuleAccountOrGroupDoctype,
  getRuleAccountOrGroupId
} from './ruleUtils'

const log = logger.namespace('settings.helpers')

const allNotifications = [
  'balanceLower',
  'transactionGreater',
  'healthBillLinked'
]

export const isNotificationEnabled = settings => {
  return allNotifications.some(notificationName =>
    get(settings, `notifications.${notificationName}.enabled`)
  )
}

export const getDefaultedSettings = incompleteSettings => {
  return merge({}, DEFAULTS_SETTINGS, incompleteSettings)
}

export const fetchSettings = async client => {
  const settingsCol = await client.query(client.find(DOCTYPE))
  return getDefaultedSettingsFromCollection(settingsCol)
}

export const updateSettings = async (client, newSettings) => {
  const col = client.collection(DOCTYPE)
  await col.update(newSettings)
}

export const reverseIndex = (items, getKeys) => {
  const ri = {}
  for (const item of items) {
    const keys = getKeys(item)
    if (!keys) {
      continue
    }
    for (const key of keys) {
      ri[key] = ri[key] || []
      ri[key].push(item)
    }
  }
  return ri
}

const maxValue = (arr, fn) => {
  const minItem = maxBy(arr, fn)
  return minItem ? fn(minItem) : -Infinity
}

export const getWarningLimitsPerAccount = (
  balanceLowerRules,
  accounts,
  groups
) => {
  const enabledRules = balanceLowerRules.filter(x => x.enabled)
  const accountIdToGroups = reverseIndex(groups, getGroupAccountIds)
  const rulesPerDoctype = groupBy(enabledRules, getRuleAccountOrGroupDoctype)
  const groupRulesById = groupBy(
    rulesPerDoctype[GROUP_DOCTYPE],
    getRuleAccountOrGroupId
  )
  const accountRulesById = groupBy(
    rulesPerDoctype[ACCOUNT_DOCTYPE],
    getRuleAccountOrGroupId
  )
  const unqualifiedRules = rulesPerDoctype['undefined'] || []
  const limitPerAccount = {}
  for (const account of accounts) {
    const groupRules = flatMap(
      accountIdToGroups[account._id] || [],
      group => groupRulesById[group._id]
    ).filter(Boolean)
    const accountRules = accountRulesById[account._id] || []
    limitPerAccount[account._id] = maxValue(
      [...unqualifiedRules, ...accountRules, ...groupRules],
      getRuleValue
    )
  }
  return limitPerAccount
}

/**
 * Make the difference between the pin setting doc and the doc where notifications
 * are configured
 */
export const isConfigurationSetting = settingDoc =>
  settingDoc.notifications ||
  settingDoc.autogroups ||
  settingDoc.linkMyselfToAccounts ||
  settingDoc.categoryBudgetAlerts ||
  settingDoc.billsMatching ||
  settingDoc.appSuggestions

export const getDefaultedSettingsFromCollection = col => {
  const settings = col && col.data && col.data.find(isConfigurationSetting)
  return getDefaultedSettings(settings)
}

export const getNotificationFromConfig = (config, name) => {
  return get(config, ['notifications', name])
}

export const getNotificationFromSettings = (settings, name) => {
  if (!settings || settings.length === 0) {
    return null
  }
  const configurationSettings = settings.find(isConfigurationSetting)
  return getNotificationFromConfig(configurationSettings, name)
}

export const DEFAULT_HEALTH_REIMBURSEMENTS_LATE_LIMIT_IN_DAYS = 30

export const getHealthReimbursementLateLimit = settings => {
  const lateNotification = getNotificationFromSettings(
    settings,
    'lateHealthReimbursement'
  )
  return (
    (lateNotification && lateNotification.value) ||
    DEFAULT_HEALTH_REIMBURSEMENTS_LATE_LIMIT_IN_DAYS
  )
}

export const fetchCategoryAlerts = async client => {
  try {
    const settings = await fetchSettings(client)
    return settings.categoryBudgetAlerts
  } catch (e) {
    log('error', `Error while fetching category alerts (${e.message})`)
    return []
  }
}

export const updateCategoryAlerts = async (client, updatedAlerts) => {
  const settings = await fetchSettings(client)
  settings.categoryBudgetAlerts = updatedAlerts
  return updateSettings(client, settings)
}

export const getAccountOrGroupLabel = (accountOrGroup, t) => {
  if (!accountOrGroup) {
    return null
  }
  switch (accountOrGroup._type) {
    case ACCOUNT_DOCTYPE:
      return getAccountLabel(accountOrGroup)
    case GROUP_DOCTYPE:
      return getGroupLabel(accountOrGroup, t)
    default:
      return ''
  }
}

export const withAccountOrGroupLabeller = propName =>
  compose(
    translate(),
    connect((state, ownProps) => ({
      [propName]: partialDoc =>
        getAccountOrGroupLabel(
          getDocumentFromState(state, partialDoc._type, partialDoc._id),
          ownProps.t
        )
    }))
  )

const boldRx = /\*(.*?)\*/g
export const markdownBold = str => {
  return str.replace(boldRx, function(a) {
    return '<b>' + a.slice(1, -1) + '</b>'
  })
}
