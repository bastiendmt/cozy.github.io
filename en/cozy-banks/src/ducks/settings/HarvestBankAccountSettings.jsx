import React, { useMemo } from 'react'
import CozyClient, { Q, Query } from 'cozy-client'

import { useI18n } from 'cozy-ui/transpiled/react/I18n'
import Dialog from 'cozy-ui/transpiled/react/Dialog'
import {
  useCozyDialog,
  DialogCloseButton
} from 'cozy-ui/transpiled/react/CozyDialogs'
import Spinner from 'cozy-ui/transpiled/react/Spinner'

import { VaultUnlockProvider, VaultUnlockPlaceholder } from 'cozy-keys-lib'
import AccountModalContent from 'cozy-harvest-lib/dist/components/AccountModal'
import EditAccountModal from 'cozy-harvest-lib/dist/components/EditAccountModal'
import HarvestVaultProvider from 'cozy-harvest-lib/dist/components/HarvestVaultProvider'

import { TrackingContext as HarvestTrackingContext } from 'cozy-harvest-lib/dist/components/hoc/tracking'

import { useTracker } from 'ducks/tracking/browser'
import HarvestSwitch from './HarvestSwitch'
import {
  COZY_ACCOUNT_DOCTYPE,
  TRIGGER_DOCTYPE,
  KONNECTOR_DOCTYPE
} from 'doctypes'

const HarvestSpinner = () => {
  return (
    <div className="u-m-2 u-ta-center">
      <Spinner size="xxlarge" />
    </div>
  )
}

const HarvestError = () => {
  const { t } = useI18n()
  return <div className="u-m-2 u-error">{t('Loading.error')}</div>
}

const fetchPolicy = CozyClient.fetchPolicies.olderThan(30 * 1000)

/**
 * Data fetching component that fetches data necessary to render Harvest
 * components related to a particular connection.
 */
const HarvestLoader = ({ connectionId, children }) => {
  return (
    <Query
      query={() => Q(COZY_ACCOUNT_DOCTYPE).getById(connectionId)}
      as={`accounts/${connectionId}`}
      fetchPolicy={fetchPolicy}
    >
      {({ data: account, fetchStatus, lastUpdate }) => {
        // Can happen for a short while when the account is deleted
        if (!account) {
          return null
        }
        if (fetchStatus === 'loading' && !lastUpdate) {
          return <HarvestSpinner />
        } else if (fetchStatus === 'error') {
          return <HarvestError />
        } else {
          const konnectorSlug = account.account_type
          return (
            <Query
              query={Q(KONNECTOR_DOCTYPE).getById(
                `${KONNECTOR_DOCTYPE}/${konnectorSlug}`
              )}
              as={`konnectors/${connectionId}`}
              fetchPolicy={fetchPolicy}
            >
              {({ data, fetchStatus, lastUpdate }) => {
                if (fetchStatus === 'loading' && !lastUpdate) {
                  return <HarvestSpinner />
                }

                if (fetchStatus === 'error') {
                  return <HarvestError />
                }

                const { attributes: konnector } = data

                // We do not query directly the triggers for the connection as
                // we need to use the /jobs/triggers route. This route is only
                // used by cozy-client when all triggers are fetched
                // Related issue : https://github.com/cozy/cozy-client/issues/767
                return (
                  <Query query={Q(TRIGGER_DOCTYPE)} as="triggers">
                    {({ data: allTriggers, fetchStatus, lastUpdate }) => {
                      const triggers = allTriggers.filter(trigger => {
                        return (
                          trigger.message &&
                          trigger.message.account === account._id
                        )
                      })
                      if (fetchStatus === 'loading' && !lastUpdate) {
                        return <HarvestSpinner />
                      } else if (fetchStatus === 'error') {
                        return <HarvestError />
                      } else {
                        const accountsAndTriggers = [account]
                          .map(account => ({
                            account,
                            trigger: triggers[0]
                          }))
                          .filter(x => x.trigger)
                        return children({
                          triggers,
                          konnector,
                          accountsAndTriggers
                        })
                      }
                    }}
                  </Query>
                )
              }}
            </Query>
          )
        }
      }}
    </Query>
  )
}

const makeTrackerForHarvest = tracker => {
  const trackPage = harvestPageName => {
    const pageName = `parametres:comptes:${harvestPageName}`
    tracker.trackPage(pageName)
  }
  const trackEvent = event => tracker.trackEvent(event)
  return { trackPage, trackEvent }
}

const HarvestTrackingProvider = ({ children }) => {
  const tracker = useTracker()
  const harvestTracker = useMemo(() => {
    return makeTrackerForHarvest(tracker)
  }, [tracker])

  return (
    <HarvestTrackingContext.Provider value={harvestTracker}>
      {children}
    </HarvestTrackingContext.Provider>
  )
}

/**
 * Shows a modal displaying the AccountModal from Harvest
 */
const HarvestBankAccountSettings = ({ connectionId, onDismiss }) => {
  const { dialogProps } = useCozyDialog({
    open: true,
    size: 'medium'
  })

  return (
    <HarvestVaultProvider>
      <VaultUnlockProvider>
        <HarvestTrackingProvider>
          <HarvestSwitch
            initialFragment={`/accounts/${connectionId}`}
            routes={[
              [
                '/accounts/:connectionId',
                connectionId => (
                  <Dialog {...dialogProps} onClose={onDismiss}>
                    <DialogCloseButton onClick={onDismiss} />
                    <HarvestLoader connectionId={connectionId}>
                      {({ triggers, konnector, accountsAndTriggers }) => {
                        return (
                          <AccountModalContent
                            initialActiveTab="configuration"
                            accountId={connectionId}
                            triggers={triggers}
                            konnector={konnector}
                            accountsAndTriggers={accountsAndTriggers}
                            onDismiss={() => {
                              onDismiss()
                            }}
                            showAccountSelection={false}
                            showNewAccountButton={false}
                          />
                        )
                      }}
                    </HarvestLoader>
                  </Dialog>
                )
              ],
              ['/accounts', () => null],
              [
                '/accounts/:connectionId/edit?reconnect',
                connectionId => (
                  // TODO Avoid passing reconnect in props,
                  // prefer to use location instead.
                  <EditModal connectionId={connectionId} reconnect={true} />
                )
              ],
              [
                '/accounts/:connectionId/edit',
                connectionId => (
                  <EditModal connectionId={connectionId} reconnect={false} />
                )
              ]
            ]}
          />
        </HarvestTrackingProvider>
        <VaultUnlockPlaceholder />
      </VaultUnlockProvider>
    </HarvestVaultProvider>
  )
}

const EditModal = React.memo(({ reconnect, connectionId }) => {
  return (
    <HarvestLoader connectionId={connectionId}>
      {({ konnector, accountsAndTriggers }) => {
        return (
          <EditAccountModal
            konnector={konnector}
            accountId={connectionId}
            accounts={accountsAndTriggers}
            reconnect={reconnect}
          />
        )
      }}
    </HarvestLoader>
  )
})
EditModal.displayName = 'EditAccountModalBanks'

export default HarvestBankAccountSettings
