import set from 'lodash/set'
import flatten from 'lodash/flatten'
import omit from 'lodash/omit'
import { dehydrate } from 'cozy-client'
import maxBy from 'lodash/maxBy'
import { getAutomaticLabelFromBundle } from './utils'
import { queryRecurrenceTransactions } from './queries'
import { TRANSACTION_DOCTYPE, RECURRENCE_DOCTYPE } from 'doctypes'

const addRelationship = (doc, relationshipName, definition) => {
  return set(doc, ['relationships', relationshipName], { data: definition })
}

export const saveBundles = async (client, recurrenceClientBundles) => {
  const recurrenceCol = client.collection(RECURRENCE_DOCTYPE)
  const saveBundlesResp = await recurrenceCol.updateAll(
    recurrenceClientBundles.map(bundle => {
      const withoutOps = omit(bundle, 'ops')
      withoutOps.automaticLabel = getAutomaticLabelFromBundle(bundle)
      const latestOperation = maxBy(bundle.ops, x => x.date)
      withoutOps.latestDate = latestOperation.date
      return withoutOps
    })
  )
  const bundlesWithIds = recurrenceClientBundles.map((recurrenceBundle, i) => ({
    ...recurrenceBundle,
    _id: saveBundlesResp[i].id
  }))
  const ops = flatten(
    bundlesWithIds.map(recurrenceBundle =>
      recurrenceBundle.ops.map(op =>
        addRelationship(dehydrate(op), 'recurrence', {
          _id: recurrenceBundle._id,
          _type: RECURRENCE_DOCTYPE
        })
      )
    )
  )

  const opCollection = client.collection('io.cozy.bank.operations')
  await opCollection.updateAll(ops.map(op => omit(op, '_type')))
}

export const resetBundles = async client => {
  const recurrenceCol = client.collection(RECURRENCE_DOCTYPE)
  const { data: serverBundles } = await recurrenceCol.all()
  await recurrenceCol.destroyAll(serverBundles)
}

const setTransactionAsUnrecurrent = transaction =>
  addRelationship(transaction, 'recurrence', {
    _id: NOT_RECURRENT_ID,
    _type: RECURRENCE_DOCTYPE
  })

export const NOT_RECURRENT_ID = 'not-recurrent'

export const deleteRecurrence = async (client, recurrence) => {
  const opCollection = client.collection(TRANSACTION_DOCTYPE)
  const { data: ops } = await client.query(
    queryRecurrenceTransactions(recurrence)
  )
  await opCollection.updateAll(
    ops.map(op => setTransactionAsUnrecurrent(omit(op, '_type')))
  )
  await client.destroy(recurrence)
}

export const renameRecurrenceManually = async (
  client,
  recurrence,
  newLabel
) => {
  return client.save({
    ...recurrence,
    manualLabel: newLabel
  })
}

const STATUS_ONGOING = 'ongoing'
const STATUS_FINISHED = 'finished'

export const getStatus = recurrence => {
  if (recurrence.status) {
    return recurrence.status
  } else {
    return STATUS_ONGOING
  }
}

export const isOngoing = recurrence => {
  const status = getStatus(recurrence)
  return status === STATUS_ONGOING
}

export const isFinished = recurrence => {
  const status = getStatus(recurrence)
  return status === STATUS_FINISHED
}

export const setStatusOngoing = async (client, recurrence) => {
  return setStatus(client, recurrence, STATUS_ONGOING)
}

export const setStatusFinished = async (client, recurrence) => {
  return setStatus(client, recurrence, STATUS_FINISHED)
}

export const setStatus = async (client, recurrence, status) => {
  client.save({
    ...recurrence,
    status
  })
}